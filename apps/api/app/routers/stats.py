"""Cost and latency aggregates for a graph, computed from persisted run events."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.db.tables import Run, RunEvent

router = APIRouter(prefix="/graphs", tags=["stats"])
Db = Annotated[AsyncSession, Depends(get_session)]


def _pct(values: list[float], p: float) -> float | None:
    if not values:
        return None
    xs = sorted(values)
    k = max(0, min(len(xs) - 1, round((p / 100) * (len(xs) - 1))))
    return xs[k]


def _bucket(samples: list[dict]) -> dict:
    lat = [s["latency_ms"] for s in samples if s.get("latency_ms") is not None]
    return {
        "calls": len(samples),
        "cost_usd": round(sum(s.get("cost_usd", 0) for s in samples), 6),
        "input_tokens": sum(s.get("input_tokens", 0) for s in samples),
        "output_tokens": sum(s.get("output_tokens", 0) for s in samples),
        "avg_ms": round(sum(lat) / len(lat)) if lat else None,
        "p50_ms": _pct(lat, 50),
        "p95_ms": _pct(lat, 95),
    }


@router.get("/{graph_id}/stats")
async def graph_stats(graph_id: uuid.UUID, db: Db, last: int = 50) -> dict:
    """Per-node and per-model cost/latency over the graph's most recent runs."""
    run_ids = (
        (
            await db.execute(
                select(Run.id)
                .where(Run.graph_id == graph_id)
                .order_by(Run.created_at.desc())
                .limit(last)
            )
        )
        .scalars()
        .all()
    )
    if not run_ids:
        return {"runs": 0, "nodes": {}, "models": {}, "total": _bucket([])}
    events = (
        (
            await db.execute(
                select(RunEvent).where(RunEvent.run_id.in_(run_ids), RunEvent.type == "node_end")
            )
        )
        .scalars()
        .all()
    )
    by_node: dict[str, list[dict]] = {}
    by_model: dict[str, list[dict]] = {}
    all_samples: list[dict] = []
    for e in events:
        usage = e.payload.get("usage") or {}
        if not usage:
            continue
        sample = {
            k: usage.get(k) for k in ("latency_ms", "cost_usd", "input_tokens", "output_tokens")
        }
        sample = {k: v for k, v in sample.items() if v is not None}
        by_node.setdefault(e.node_id or "?", []).append(sample)
        if usage.get("model"):
            by_model.setdefault(usage["model"], []).append(sample)
        all_samples.append(sample)
    return {
        "runs": len(run_ids),
        "nodes": {n: _bucket(s) for n, s in by_node.items()},
        "models": {m: _bucket(s) for m, s in by_model.items()},
        "total": _bucket([s for s in all_samples if "cost_usd" in s]),
    }
