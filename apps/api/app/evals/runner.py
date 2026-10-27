"""Runs a dataset through a graph, scores every row, and aggregates the results."""

import asyncio
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import SessionLocal
from app.db.tables import Dataset, EvalResult, EvalRun, Run
from app.engine import bus
from app.engine.executor import execute
from app.evals.scorers import ScorerSpec, score
from app.observability import langfuse_export
from app.schemas.graph import GraphSpec

CONCURRENCY = 3  # free-tier friendly: Groq allows ~30 requests/min
MAX_HUMAN_RESUMES = 5


async def _run_row(spec: GraphSpec, row: dict, graph_id: uuid.UUID, version: int) -> Run:
    """Execute one dataset row as a normal Run. Human nodes are answered from row["human"]."""
    answers: list[Any] = row.get("human", [])
    if not isinstance(answers, list):
        answers = [answers]
    async with SessionLocal() as db:
        run = Run(
            graph_id=graph_id,
            graph_version=version,
            thread_id=str(uuid.uuid4()),
            status="queued",
            input=row.get("input", {}),
        )
        db.add(run)
        await db.commit()
        run_id = run.id
    await execute(run_id, spec)
    for i in range(MAX_HUMAN_RESUMES):
        async with SessionLocal() as db:
            run = await db.get(Run, run_id)
            if run.status != "paused":
                break
            if i >= len(answers):
                run.status = "error"
                run.error = "paused at a human node and the dataset row has no `human` answer"
                await db.commit()
                break
        await execute(run_id, spec, answers[i])
    async with SessionLocal() as db:
        return await db.get(Run, run_id)


async def _bump_progress(eval_id: uuid.UUID, total: int, row: int) -> None:
    """Atomic increment: rows finish concurrently, a read-modify-write would lose updates."""
    async with SessionLocal() as db:
        await db.execute(
            update(EvalRun).where(EvalRun.id == eval_id).values(completed=EvalRun.completed + 1)
        )
        await db.commit()
        done = await db.scalar(select(EvalRun.completed).where(EvalRun.id == eval_id))
    bus.publish(eval_id, {"type": "eval_progress", "completed": done, "total": total, "row": row})


async def execute_eval(eval_id: uuid.UUID, spec: GraphSpec) -> None:
    async with SessionLocal() as db:
        ev = await db.get(EvalRun, eval_id)
        if ev is None:
            return
        ds = await db.get(Dataset, ev.dataset_id)
        rows: list[dict] = list(ds.rows) if ds else []
        scorers = [ScorerSpec.model_validate(s) for s in ev.scorers]
        graph_id, version = ev.graph_id, ev.graph_version
        ev.status, ev.total, ev.completed = "running", len(rows), 0
        await db.commit()
    bus.publish(
        eval_id, {"type": "eval_status", "status": "running", "completed": 0, "total": len(rows)}
    )

    sem = asyncio.Semaphore(CONCURRENCY)

    async def one(i: int, row: dict) -> None:
        async with sem:
            result = EvalResult(eval_run_id=eval_id, row_index=i, scores={}, usage={})
            t0 = datetime.now(UTC)
            try:
                run = await _run_row(spec, row, graph_id, version)
                result.run_id = run.id
                result.output = run.output
                result.usage = dict(run.usage or {})
                result.error = run.error
                if run.status == "done":
                    for s in scorers:
                        sc = await score(s, run.output or {}, row)
                        result.scores[s.name] = sc.as_dict()
                        if sc.usage:
                            result.usage["judge_cost_usd"] = round(
                                result.usage.get("judge_cost_usd", 0) + sc.usage.cost_usd, 6
                            )
                    if langfuse_export.enabled() and result.scores:
                        await asyncio.to_thread(
                            langfuse_export.export_scores, run.id, result.scores
                        )
            except Exception as e:  # noqa: BLE001 - one bad row must not sink the eval
                result.error = f"{type(e).__name__}: {e}"
            result.duration_ms = int((datetime.now(UTC) - t0).total_seconds() * 1000)
            async with SessionLocal() as db:
                db.add(result)
                await db.commit()
            await _bump_progress(eval_id, len(rows), i)

    try:
        await asyncio.gather(*(one(i, r) for i, r in enumerate(rows)))
        async with SessionLocal() as db:
            ev = await db.get(EvalRun, eval_id)
            ev.summary = await summarize(db, ev, spec)
            ev.completed = ev.summary["rows"]
            ev.status, ev.finished_at = "done", datetime.now(UTC)
            await db.commit()
    except asyncio.CancelledError:
        async with SessionLocal() as db:
            ev = await db.get(EvalRun, eval_id)
            ev.status, ev.finished_at = "cancelled", datetime.now(UTC)
            await db.commit()
    except Exception as e:  # noqa: BLE001
        async with SessionLocal() as db:
            ev = await db.get(EvalRun, eval_id)
            ev.status, ev.error = "error", f"{type(e).__name__}: {e}"
            ev.finished_at = datetime.now(UTC)
            await db.commit()
    bus.publish(eval_id, {"type": "eval_status", "status": "done"})


async def summarize(db: AsyncSession, ev: EvalRun, spec: GraphSpec) -> dict:
    """Pass rates per scorer, cost/latency totals, and per-node failure attribution for the heatmap.

    Attribution: a failed scorer on key K is charged to the node that writes K. It is a
    heuristic, but it points at the right place far more often than not.
    """
    results = (
        (await db.execute(select(EvalResult).where(EvalResult.eval_run_id == ev.id)))
        .scalars()
        .all()
    )
    scorers = [ScorerSpec.model_validate(s) for s in ev.scorers]
    writers_of: dict[str, list[str]] = {}  # output key -> every node that writes it
    for n in spec.nodes:
        key = getattr(n.config, "output_key", None)
        if key:
            writers_of.setdefault(key, []).append(n.id)

    per_scorer: dict[str, dict] = {}
    for s in scorers:
        vals = [r.scores[s.name]["score"] for r in results if s.name in r.scores]
        passed = [r.scores[s.name]["passed"] for r in results if s.name in r.scores]
        per_scorer[s.name] = {
            "kind": s.kind,
            "key": s.key,
            "n": len(vals),
            "pass_rate": round(sum(passed) / len(passed), 4) if passed else None,
            "avg_score": round(sum(vals) / len(vals), 4) if vals else None,
            "nodes": writers_of.get(s.key, []),
        }

    # a row counts once per node, however many scorers failed on it, so shares stay within 0..1
    node_fail: dict[str, int] = {}
    for r in results:
        blamed: set[str] = set()
        for s in scorers:
            sc = r.scores.get(s.name)
            if sc and not sc["passed"]:
                blamed.update(writers_of.get(s.key, []))
        for node in blamed:
            node_fail[node] = node_fail.get(node, 0) + 1
    n_rows = max(len(results), 1)
    heat = {node: round(c / n_rows, 4) for node, c in node_fail.items()}

    errors = [r for r in results if r.error]
    all_passed = [all(sc["passed"] for sc in r.scores.values()) for r in results if r.scores]
    return {
        "rows": len(results),
        "errors": len(errors),
        "pass_rate": round(sum(all_passed) / len(all_passed), 4) if all_passed else None,
        "scorers": per_scorer,
        "node_failure_share": heat,
        "cost_usd": round(
            sum(r.usage.get("cost_usd", 0) + r.usage.get("judge_cost_usd", 0) for r in results), 6
        ),
        "avg_duration_ms": int(sum(r.duration_ms or 0 for r in results) / n_rows),
    }
