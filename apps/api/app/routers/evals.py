import asyncio
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.db.tables import Dataset, EvalResult, EvalRun, Graph
from app.engine import bus
from app.engine.compiler import compile_graph
from app.evals.runner import execute_eval
from app.evals.scorers import ScorerSpec
from app.schemas.graph import GraphSpec

Db = Annotated[AsyncSession, Depends(get_session)]

datasets = APIRouter(prefix="/datasets", tags=["evals"])
evals = APIRouter(prefix="/evals", tags=["evals"])


# ---- datasets --------------------------------------------------------------------------


class DatasetRow(BaseModel):
    input: dict[str, Any] = Field(default_factory=dict)
    expected: Any = None
    human: Any = None  # answer(s) for human nodes, so evals can run unattended


class DatasetBody(BaseModel):
    graph_id: uuid.UUID | None = None
    name: str = Field(min_length=1, max_length=120)
    rows: list[DatasetRow] = Field(default_factory=list, max_length=500)


def _ds(d: Dataset) -> dict:
    return {
        "id": str(d.id),
        "graph_id": str(d.graph_id) if d.graph_id else None,
        "name": d.name,
        "rows": d.rows,
        "updated_at": d.updated_at,
    }


@datasets.post("", status_code=status.HTTP_201_CREATED)
async def create_dataset(body: DatasetBody, db: Db) -> dict:
    d = Dataset(
        graph_id=body.graph_id,
        name=body.name,
        rows=[r.model_dump(exclude_none=True) for r in body.rows],
    )
    db.add(d)
    await db.commit()
    await db.refresh(d)
    return _ds(d)


@datasets.get("")
async def list_datasets(db: Db, graph_id: uuid.UUID | None = None) -> list[dict]:
    q = select(Dataset).order_by(Dataset.updated_at.desc())
    if graph_id:
        q = q.where(Dataset.graph_id == graph_id)
    return [_ds(d) for d in (await db.execute(q)).scalars().all()]


@datasets.get("/{dataset_id}")
async def get_dataset(dataset_id: uuid.UUID, db: Db) -> dict:
    d = await db.get(Dataset, dataset_id)
    if d is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "dataset not found")
    return _ds(d)


@datasets.put("/{dataset_id}")
async def update_dataset(dataset_id: uuid.UUID, body: DatasetBody, db: Db) -> dict:
    d = await db.get(Dataset, dataset_id)
    if d is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "dataset not found")
    d.name = body.name
    d.rows = [r.model_dump(exclude_none=True) for r in body.rows]
    await db.commit()
    await db.refresh(d)
    return _ds(d)


@datasets.delete("/{dataset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_dataset(dataset_id: uuid.UUID, db: Db) -> None:
    d = await db.get(Dataset, dataset_id)
    if d is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "dataset not found")
    await db.delete(d)
    await db.commit()


# ---- evals -----------------------------------------------------------------------------


class EvalBody(BaseModel):
    graph_id: uuid.UUID
    dataset_id: uuid.UUID
    scorers: list[ScorerSpec] = Field(min_length=1)


def _ev(e: EvalRun, dataset_name: str | None = None) -> dict:
    return {
        "id": str(e.id),
        "graph_id": str(e.graph_id),
        "graph_version": e.graph_version,
        "dataset_id": str(e.dataset_id),
        "dataset_name": dataset_name,
        "scorers": e.scorers,
        "status": e.status,
        "total": e.total,
        "completed": e.completed,
        "summary": e.summary,
        "error": e.error,
        "created_at": e.created_at,
        "finished_at": e.finished_at,
    }


@evals.post("", status_code=status.HTTP_202_ACCEPTED)
async def create_eval(body: EvalBody, db: Db) -> dict:
    graph = await db.get(Graph, body.graph_id)
    if graph is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "graph not found")
    ds = await db.get(Dataset, body.dataset_id)
    if ds is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "dataset not found")
    if not ds.rows:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "dataset has no rows")
    spec = GraphSpec.model_validate(graph.spec)
    if issues := spec.lint_issues():
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            {"message": "graph has unresolved issues", "issues": [i.model_dump() for i in issues]},
        )
    compile_graph(spec)
    ev = EvalRun(
        graph_id=graph.id,
        graph_version=graph.version,
        dataset_id=ds.id,
        scorers=[s.model_dump() for s in body.scorers],
        status="queued",
        total=len(ds.rows),
    )
    db.add(ev)
    await db.commit()
    await db.refresh(ev)
    task = asyncio.create_task(execute_eval(ev.id, spec))
    bus.track(ev.id, task)
    return _ev(ev, ds.name)


@evals.get("")
async def list_evals(db: Db, graph_id: uuid.UUID | None = None, limit: int = 30) -> list[dict]:
    q = (
        select(EvalRun, Dataset.name)
        .join(Dataset, Dataset.id == EvalRun.dataset_id, isouter=True)
        .order_by(EvalRun.created_at.desc())
        .limit(limit)
    )
    if graph_id:
        q = q.where(EvalRun.graph_id == graph_id)
    return [_ev(e, name) for e, name in (await db.execute(q)).all()]


@evals.get("/{eval_id}")
async def get_eval(eval_id: uuid.UUID, db: Db) -> dict:
    ev = await db.get(EvalRun, eval_id)
    if ev is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "eval not found")
    ds = await db.get(Dataset, ev.dataset_id)
    rows = ds.rows if ds else []
    results = (
        (
            await db.execute(
                select(EvalResult)
                .where(EvalResult.eval_run_id == eval_id)
                .order_by(EvalResult.row_index)
            )
        )
        .scalars()
        .all()
    )
    return {
        **_ev(ev, ds.name if ds else None),
        "results": [
            {
                "row_index": r.row_index,
                "run_id": str(r.run_id) if r.run_id else None,
                "output": r.output,
                "scores": r.scores,
                "usage": r.usage,
                "duration_ms": r.duration_ms,
                "error": r.error,
                "input": rows[r.row_index].get("input") if r.row_index < len(rows) else None,
                "expected": rows[r.row_index].get("expected") if r.row_index < len(rows) else None,
            }
            for r in results
        ],
    }


@evals.post("/{eval_id}/cancel")
async def cancel_eval(eval_id: uuid.UUID, db: Db) -> dict:
    ev = await db.get(EvalRun, eval_id)
    if ev is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "eval not found")
    if ev.status != "running" or not bus.cancel(eval_id):
        raise HTTPException(status.HTTP_409_CONFLICT, f"eval is {ev.status}, nothing to cancel")
    return {**_ev(ev), "status": "cancelling"}
