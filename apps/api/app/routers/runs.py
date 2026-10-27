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
from app.engine.executor import run_config, start_in_background
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
        "status": run.status,
        "input": run.input,
        "output": run.output,
        "interrupt": run.interrupt,
        "error": run.error,
        "usage": run.usage,
        "duration_ms": _duration_ms(run),
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
    """Every checkpoint of the run's thread, oldest first, with the state at that point.

    `node` is the node whose completion produced the checkpoint (the previous checkpoint's
    `next`), so the list reads as a step-by-step history of the run.
    """
    run = await _get(db, run_id)
    spec = await _spec_for(db, run)
    graph = compile_graph(spec, get_checkpointer())
    history = [s async for s in graph.aget_state_history(run_config(run.thread_id))]
    history.reverse()  # LangGraph yields newest first
    out: list[dict] = []
    prev_next: list[str] = []
    for snap in history:
        step = snap.metadata.get("step") if snap.metadata else None
        if step is not None and step < 0:  # LangGraph's input checkpoint, before __start__ ran
            prev_next = list(snap.next)
            continue
        cfg = snap.config["configurable"]
        node = prev_next[0] if prev_next else None
        out.append(
            {
                "checkpoint_id": cfg["checkpoint_id"],
                "parent_id": ((snap.parent_config or {}).get("configurable") or {}).get(
                    "checkpoint_id"
                ),
                "step": step,
                "node": None if node == "__start__" else node,
                "next": list(snap.next),
                "created_at": snap.created_at,
                "vars": snap.values.get("vars", {}),
                "trace": snap.values.get("trace", []),
                "interrupted": bool(getattr(snap, "interrupts", ())),
            }
        )
        prev_next = list(snap.next)
    return out
