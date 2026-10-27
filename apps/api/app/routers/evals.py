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
        "sweep_id": str(e.sweep_id) if e.sweep_id else None,
        "node_id": e.node_id,
        "variant": e.variant,
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


@evals.get("/sweeps")
async def list_sweeps(db: Db, graph_id: uuid.UUID) -> list[dict]:
    rows = (
        (
            await db.execute(
                select(EvalRun)
                .where(EvalRun.graph_id == graph_id, EvalRun.sweep_id.is_not(None))
                .order_by(EvalRun.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    by: dict[str, list[EvalRun]] = {}
    for e in rows:
        by.setdefault(str(e.sweep_id), []).append(e)
    return [
        {
            "sweep_id": sid,
            "node_id": evs[0].node_id,
            "models": [e.variant for e in evs],
            "created_at": evs[0].created_at,
            "status": "done"
            if all(e.status in ("done", "error", "cancelled") for e in evs)
            else "running",
        }
        for sid, evs in by.items()
    ]


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


# ---- model sweeps ----------------------------------------------------------------------


class SweepBody(BaseModel):
    graph_id: uuid.UUID
    dataset_id: uuid.UUID
    scorers: list[ScorerSpec] = Field(min_length=1)
    node_id: str
    models: list[str] = Field(min_length=1, max_length=6)


@evals.post("/sweep", status_code=status.HTTP_202_ACCEPTED)
async def create_sweep(body: SweepBody, db: Db) -> dict:
    """Run the same eval once per candidate model for one LLM node, so the models can be ranked
    on accuracy and cost. Each variant is an ordinary eval run tagged with the sweep id."""
    from app.llm.catalog import CATALOG

    graph = await db.get(Graph, body.graph_id)
    if graph is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "graph not found")
    ds = await db.get(Dataset, body.dataset_id)
    if ds is None or not ds.rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "dataset not found or empty")
    spec = GraphSpec.model_validate(graph.spec)
    if issues := spec.lint_issues():
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            {"message": "graph has unresolved issues", "issues": [i.model_dump() for i in issues]},
        )
    node = next((n for n in spec.nodes if n.id == body.node_id), None)
    if node is None or node.type != "llm":
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, f"{body.node_id} is not a model node"
        )
    unknown = [m for m in body.models if m not in CATALOG]
    if unknown:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"unknown models {unknown}")

    sweep_id = uuid.uuid4()
    out = []
    jobs: list[tuple[uuid.UUID, GraphSpec]] = []
    for model in body.models:
        variant = spec.model_copy(deep=True)
        target = next(n for n in variant.nodes if n.id == body.node_id)
        target.config.model = model
        ev = EvalRun(
            graph_id=graph.id,
            graph_version=graph.version,
            dataset_id=ds.id,
            scorers=[s.model_dump() for s in body.scorers],
            sweep_id=sweep_id,
            node_id=body.node_id,
            variant=model,
            status="queued",
            total=len(ds.rows),
        )
        db.add(ev)
        await db.commit()
        await db.refresh(ev)
        jobs.append((ev.id, variant))
        out.append(_ev(ev, ds.name))

    async def run_all() -> None:
        # one variant at a time: keeps free-tier rate limits happy and makes latencies comparable
        for ev_id, variant_spec in jobs:
            await execute_eval(ev_id, variant_spec)

    bus.track(sweep_id, asyncio.create_task(run_all()))
    return {"sweep_id": str(sweep_id), "node_id": body.node_id, "evals": out}


def _recommend(variants: list[dict], tolerance: float = 0.05) -> str | None:
    """Cheapest model whose pass rate is within `tolerance` of the best one."""
    done = [
        v for v in variants if v["status"] == "done" and v["summary"].get("pass_rate") is not None
    ]
    if not done:
        return None
    best = max(v["summary"]["pass_rate"] for v in done)
    good = [v for v in done if v["summary"]["pass_rate"] >= best - tolerance]
    return min(good, key=lambda v: (v["summary"]["cost_usd"], v["summary"]["avg_duration_ms"]))[
        "variant"
    ]


@evals.get("/sweeps/{sweep_id}")
async def get_sweep(sweep_id: uuid.UUID, db: Db) -> dict:
    rows = (
        await db.execute(
            select(EvalRun, Dataset.name)
            .join(Dataset, Dataset.id == EvalRun.dataset_id, isouter=True)
            .where(EvalRun.sweep_id == sweep_id)
            .order_by(EvalRun.created_at)
        )
    ).all()
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "sweep not found")
    variants = [_ev(e, name) for e, name in rows]
    return {
        "sweep_id": str(sweep_id),
        "node_id": rows[0][0].node_id,
        "variants": variants,
        "recommended": _recommend(variants),
        "done": all(v["status"] in ("done", "error", "cancelled") for v in variants),
    }
