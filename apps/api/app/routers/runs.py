import uuid
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.db.tables import Graph, Run, RunEvent
from app.engine import bus
from app.engine.checkpointer import get_checkpointer
from app.engine.compiler import compile_graph
from app.engine.executor import CONTINUE, run_config, start_in_background
from app.observability import langfuse_export
from app.observability.trace import build_trace, to_otel_json
from app.schemas.graph import GraphSpec

router = APIRouter(prefix="/runs", tags=["runs"])
Db = Annotated[AsyncSession, Depends(get_session)]


class RunCreate(BaseModel):
    graph_id: uuid.UUID
    input: dict[str, Any] = Field(default_factory=dict)


class ResumeBody(BaseModel):
    value: Any


def _utc(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)  # SQLite hands back naive datetimes


def _duration_ms(run: Run) -> int | None:
    if run.started_at is None:
        return None
    end = _utc(run.finished_at) if run.finished_at else datetime.now(UTC)
    return int((end - _utc(run.started_at)).total_seconds() * 1000)


def _view(run: Run) -> dict:
    return {
        "id": str(run.id),
        "graph_id": str(run.graph_id),
        "graph_version": run.graph_version,
        "parent_run_id": str(run.parent_run_id) if run.parent_run_id else None,
        "fork_checkpoint_id": run.fork_checkpoint_id,
        "head_checkpoint_id": run.head_checkpoint_id,
        "status": run.status,
        "input": run.input,
        "output": run.output,
        "interrupt": run.interrupt,
        "error": run.error,
        "usage": run.usage,
        "duration_ms": _duration_ms(run),
        "trace_url": langfuse_export.trace_url(run.id),
        "started_at": run.started_at,
        "finished_at": run.finished_at,
        "created_at": run.created_at,
        "updated_at": run.updated_at,
    }


async def _get(db: AsyncSession, run_id: uuid.UUID) -> Run:
    run = await db.get(Run, run_id)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "run not found")
    return run


async def _spec_for(db: AsyncSession, run: Run) -> GraphSpec:
    graph = await db.get(Graph, run.graph_id)
    if graph is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "graph was deleted")
    return GraphSpec.model_validate(graph.spec)


@router.post("", status_code=status.HTTP_202_ACCEPTED)
async def create_run(body: RunCreate, db: Db) -> dict:
    graph = await db.get(Graph, body.graph_id)
    if graph is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "graph not found")
    spec = GraphSpec.model_validate(graph.spec)
    if issues := spec.lint_issues():
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            {"message": "graph has unresolved issues", "issues": [i.model_dump() for i in issues]},
        )
    try:
        compile_graph(spec)  # surface compile errors (unknown tool, ...) before queueing
    except Exception as e:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, f"graph does not compile: {e}"
        ) from e

    run = Run(
        graph_id=graph.id,
        graph_version=graph.version,
        thread_id=str(uuid.uuid4()),
        status="queued",
        input=body.input,
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)  # load server-generated timestamps before the session closes
    start_in_background(run.id, spec)
    return _view(run)


@router.get("")
async def list_runs(
    db: Db, graph_id: uuid.UUID | None = None, status_: str | None = None, limit: int = 50
) -> list[dict]:
    q = select(Run).order_by(Run.created_at.desc()).limit(limit)
    if graph_id:
        q = q.where(Run.graph_id == graph_id)
    if status_:
        q = q.where(Run.status == status_)
    return [_view(r) for r in (await db.execute(q)).scalars().all()]


@router.get("/{run_id}")
async def get_run(run_id: uuid.UUID, db: Db) -> dict:
    return _view(await _get(db, run_id))


@router.get("/{run_id}/events")
async def get_events(run_id: uuid.UUID, db: Db, after: int = 0) -> list[dict]:
    await _get(db, run_id)
    q = (
        select(RunEvent)
        .where(RunEvent.run_id == run_id, RunEvent.seq > after)
        .order_by(RunEvent.seq)
    )
    return [
        {"seq": e.seq, "type": e.type, "node": e.node_id, "ts": e.ts, **e.payload}
        for e in (await db.execute(q)).scalars().all()
    ]


@router.post("/{run_id}/resume", status_code=status.HTTP_202_ACCEPTED)
async def resume_run(run_id: uuid.UUID, body: ResumeBody, db: Db) -> dict:
    run = await _get(db, run_id)
    if run.status != "paused":
        raise HTTPException(status.HTTP_409_CONFLICT, f"run is {run.status}, not paused")
    spec = await _spec_for(db, run)
    run.status = "queued"
    await db.commit()
    await db.refresh(run)
    start_in_background(run.id, spec, body.value)
    return _view(run)


@router.post("/{run_id}/cancel")
async def cancel_run(run_id: uuid.UUID, db: Db) -> dict:
    run = await _get(db, run_id)
    if run.status == "paused":  # nothing is executing; just close it out
        run.status = "cancelled"
        await db.commit()
        await db.refresh(run)
        bus.publish(run_id, {"seq": None, "type": "status", "status": "cancelled"})
        return _view(run)
    if run.status != "running" or not bus.cancel(run_id):
        raise HTTPException(status.HTTP_409_CONFLICT, f"run is {run.status}, nothing to cancel")
    return {**_view(run), "status": "cancelling"}


@router.get("/{run_id}/checkpoints")
async def get_checkpoints(run_id: uuid.UUID, db: Db) -> list[dict]:
    """This run's checkpoints, oldest first, with the state at each one.

    Forks share a thread, so the list is built by walking parent pointers back from the
    run's head rather than listing the whole thread. `node` is the node whose completion
    produced the checkpoint (the previous checkpoint's `next`); `forked` marks a state that
    was edited by hand.
    """
    run = await _get(db, run_id)
    spec = await _spec_for(db, run)
    graph = compile_graph(spec, get_checkpointer())

    snaps = []
    if run.head_checkpoint_id:
        cfg: dict | None = run_config(run.thread_id, run.head_checkpoint_id)
        while cfg:
            snap = await graph.aget_state(cfg)
            if not snap or not snap.config:
                break
            snaps.append(snap)
            cfg = snap.parent_config
        snaps.reverse()
    else:  # runs recorded before head tracking existed
        snaps = [s async for s in graph.aget_state_history(run_config(run.thread_id))]
        snaps.reverse()

    out: list[dict] = []
    prev_next: list[str] = []
    for snap in snaps:
        meta = snap.metadata or {}
        step = meta.get("step")
        if step is not None and step < 0:  # LangGraph's input checkpoint, before __start__ ran
            prev_next = list(snap.next)
            continue
        c = snap.config["configurable"]
        node = prev_next[0] if prev_next else None
        forked = meta.get("source") == "update"
        out.append(
            {
                "checkpoint_id": c["checkpoint_id"],
                "parent_id": ((snap.parent_config or {}).get("configurable") or {}).get(
                    "checkpoint_id"
                ),
                "step": step,
                "node": None if (node == "__start__" or forked) else node,
                "next": list(snap.next),
                "created_at": snap.created_at,
                "vars": snap.values.get("vars", {}),
                "trace": snap.values.get("trace", []),
                "interrupted": bool(getattr(snap, "interrupts", ())),
                "forked": forked,
            }
        )
        prev_next = list(snap.next)
    return out


class ForkBody(BaseModel):
    checkpoint_id: str
    vars: dict[str, Any] = Field(default_factory=dict)


@router.post("/{run_id}/fork", status_code=status.HTTP_202_ACCEPTED)
async def fork_run(run_id: uuid.UUID, body: ForkBody, db: Db) -> dict:
    """Branch a new run off one of this run's checkpoints with edited variables.

    The edit becomes a new checkpoint (LangGraph `update_state`) whose parent is the chosen
    one, so the original run keeps its history and the fork continues from the edit.
    """
    parent = await _get(db, run_id)
    spec = await _spec_for(db, parent)
    graph = compile_graph(spec, get_checkpointer())
    base = run_config(parent.thread_id, body.checkpoint_id)
    snap = await graph.aget_state(base)
    if (
        not snap
        or not snap.metadata  # an unknown id comes back as an empty snapshot echoing the config
        or snap.config["configurable"].get("checkpoint_id") != body.checkpoint_id
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "checkpoint not found on this run")
    if not snap.next:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "cannot fork from the final checkpoint: nothing left to run"
        )

    forked = await graph.aupdate_state(base, {"vars": body.vars} if body.vars else {})
    run = Run(
        graph_id=parent.graph_id,
        graph_version=parent.graph_version,
        thread_id=parent.thread_id,
        parent_run_id=parent.id,
        fork_checkpoint_id=body.checkpoint_id,
        head_checkpoint_id=forked["configurable"]["checkpoint_id"],
        status="queued",
        input=parent.input,
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)
    start_in_background(run.id, spec, CONTINUE)
    return _view(run)


@router.get("/{run_id}/trace")
async def get_trace(run_id: uuid.UUID, db: Db) -> dict:
    """The run as an OpenTelemetry-style trace (OTLP/JSON layout), built from its events."""
    await _get(db, run_id)
    rows = (
        (await db.execute(select(RunEvent).where(RunEvent.run_id == run_id).order_by(RunEvent.seq)))
        .scalars()
        .all()
    )
    return to_otel_json(run_id, build_trace(run_id, rows))
