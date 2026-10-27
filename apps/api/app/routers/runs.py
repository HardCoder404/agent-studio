import uuid
from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.db.tables import Graph, Run, RunEvent
from app.engine.compiler import compile_graph
from app.engine.executor import execute
from app.schemas.graph import GraphSpec

router = APIRouter(prefix="/runs", tags=["runs"])
Db = Annotated[AsyncSession, Depends(get_session)]


class RunCreate(BaseModel):
    graph_id: uuid.UUID
    input: dict[str, Any] = Field(default_factory=dict)


class ResumeBody(BaseModel):
    value: Any


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
async def create_run(body: RunCreate, db: Db, tasks: BackgroundTasks) -> dict:
    graph = await db.get(Graph, body.graph_id)
    if graph is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "graph not found")
    spec = GraphSpec.model_validate(graph.spec)
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
    tasks.add_task(execute, run.id, spec)
    return _view(run)


@router.get("")
async def list_runs(db: Db, graph_id: uuid.UUID | None = None, limit: int = 50) -> list[dict]:
    q = select(Run).order_by(Run.created_at.desc()).limit(limit)
    if graph_id:
        q = q.where(Run.graph_id == graph_id)
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
async def resume_run(run_id: uuid.UUID, body: ResumeBody, db: Db, tasks: BackgroundTasks) -> dict:
    run = await _get(db, run_id)
    if run.status != "paused":
        raise HTTPException(status.HTTP_409_CONFLICT, f"run is {run.status}, not paused")
    spec = await _spec_for(db, run)
    run.status = "queued"
    await db.commit()
    await db.refresh(run)
    tasks.add_task(execute, run.id, spec, body.value)
    return _view(run)
