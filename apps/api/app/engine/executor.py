"""Runs a compiled graph for one Run row, persisting events and the final state."""

import uuid
from typing import Any

from langgraph.types import Command
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import SessionLocal
from app.db.tables import Run, RunEvent
from app.engine.checkpointer import get_checkpointer
from app.engine.compiler import compile_graph
from app.schemas.graph import GraphSpec

RECURSION_LIMIT = 100


def run_config(thread_id: str) -> dict:
    return {"configurable": {"thread_id": thread_id}, "recursion_limit": RECURSION_LIMIT}


class EventSink:
    """Appends numbered events to run_events."""

    def __init__(self, db: AsyncSession, run_id: uuid.UUID):
        self.db, self.run_id = db, run_id
        self.seq = 0

    async def start(self) -> None:
        last = await self.db.scalar(
            select(func.max(RunEvent.seq)).where(RunEvent.run_id == self.run_id)
        )
        self.seq = last or 0

    async def emit(self, type: str, node_id: str | None = None, **payload: Any) -> None:
        self.seq += 1
        self.db.add(
            RunEvent(run_id=self.run_id, seq=self.seq, type=type, node_id=node_id, payload=payload)
        )
        await self.db.commit()


def _sum_usage(trace: list[dict]) -> dict:
    total = {"input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0, "llm_calls": 0}
    for t in trace:
        if "model" in t:
            total["llm_calls"] += 1
            total["input_tokens"] += t.get("input_tokens", 0)
            total["output_tokens"] += t.get("output_tokens", 0)
            total["cost_usd"] += t.get("cost_usd", 0.0)
    total["cost_usd"] = round(total["cost_usd"], 6)
    return total


async def execute(run_id: uuid.UUID, spec: GraphSpec, resume_value: Any | None = None) -> None:
    """Start a run (resume_value=None) or resume a paused one. Safe to call as a background task."""
    async with SessionLocal() as db:
        run = await db.get(Run, run_id)
        if run is None:
            return
        sink = EventSink(db, run_id)
        await sink.start()
        graph = compile_graph(spec, get_checkpointer())
        config = run_config(run.thread_id)

        skip_start: str | None = None
        if resume_value is None:
            payload: Any = {"vars": dict(run.input), "trace": []}
            await sink.emit("run_start", input=run.input)
        else:
            payload = Command(resume=resume_value)
            await sink.emit("run_resume", value=resume_value)
            # LangGraph re-enters the interrupted node from the top on resume, so that node
            # would report a second node_start. The first one is already in the log.
            skip_start = (run.interrupt or {}).get("node")

        run.status, run.interrupt = "running", None
        await db.commit()

        try:
            async for mode, chunk in graph.astream(
                payload, config, stream_mode=["custom", "updates"]
            ):
                if mode == "custom":
                    ev = dict(chunk)
                    type_, node = ev.pop("type"), ev.pop("node", None)
                    if type_ == "node_start" and node == skip_start:
                        skip_start = None
                        continue
                    await sink.emit(type_, node, **ev)
                elif mode == "updates" and "__interrupt__" in chunk:
                    intr = chunk["__interrupt__"][0].value
                    run.status, run.interrupt = "paused", intr
                    await sink.emit("interrupt", intr.get("node"), **intr)
                    await db.commit()
                    return

            state = await graph.aget_state(config)
            run.output = state.values.get("vars", {})
            run.usage = _sum_usage(state.values.get("trace", []))
            run.status = "done"
            await sink.emit("run_end", output=run.output, usage=run.usage)
        except Exception as e:  # noqa: BLE001 - any failure ends the run with a message
            run.status, run.error = "error", f"{type(e).__name__}: {e}"
            await sink.emit("run_error", error=run.error)
        await db.commit()
