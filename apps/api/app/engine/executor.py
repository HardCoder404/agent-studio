"""Runs a compiled graph for one Run row: persists events, streams them to subscribers."""

import asyncio
import uuid
from datetime import UTC, datetime
from typing import Any

from langgraph.types import Command
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import SessionLocal
from app.db.tables import Graph, Run, RunEvent
from app.engine import bus
from app.engine.checkpointer import get_checkpointer
from app.engine.compiler import compile_graph
from app.engine.context import current_graph_id
from app.integrations import telegram
from app.observability import langfuse_export
from app.schemas.graph import GraphSpec

RECURSION_LIMIT = 100
TERMINAL = {"done", "error", "cancelled"}


def run_config(thread_id: str, checkpoint_id: str | None = None) -> dict:
    cfg: dict = {"thread_id": thread_id, "checkpoint_ns": ""}
    if checkpoint_id:
        cfg["checkpoint_id"] = checkpoint_id  # pin: read or resume at exactly this checkpoint
    return {"configurable": cfg, "recursion_limit": RECURSION_LIMIT}


CONTINUE = object()  # sentinel: proceed from the run's head checkpoint without new input (forks)


class EventSink:
    """Numbers events, writes them to run_events and fans them out to live subscribers."""

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
        ts = datetime.now(UTC)
        self.db.add(
            RunEvent(
                run_id=self.run_id, seq=self.seq, type=type, node_id=node_id, payload=payload, ts=ts
            )
        )
        await self.db.commit()
        bus.publish(
            self.run_id,
            {"seq": self.seq, "type": type, "node": node_id, "ts": ts.isoformat(), **payload},
        )

    def live(self, type: str, node_id: str | None = None, **payload: Any) -> None:
        """Fan out without persisting (tokens): cheap, and node_end carries the full text anyway."""
        bus.publish(self.run_id, {"seq": None, "type": type, "node": node_id, **payload})


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


def start_in_background(
    run_id: uuid.UUID, spec: GraphSpec, resume_value: Any | None = None
) -> asyncio.Task:
    task = asyncio.create_task(execute(run_id, spec, resume_value))
    bus.track(run_id, task)
    return task


async def execute(run_id: uuid.UUID, spec: GraphSpec, resume_value: Any = None) -> None:
    """Start a run (resume_value=None), resume a paused one, or continue a fork (CONTINUE)."""
    async with SessionLocal() as db:
        run = await db.get(Run, run_id)
        if run is None:
            return
        sink = EventSink(db, run_id)
        current_graph_id.set(run.graph_id)  # lets tools find the graph (telegram_send)
        await sink.start()
        graph = compile_graph(spec, get_checkpointer())
        # Reads use the thread; the stream starts from this run's head so sibling forks on the
        # same thread never get mixed up.
        config = run_config(run.thread_id)
        start_config = run_config(run.thread_id, run.head_checkpoint_id)

        skip_start: str | None = None
        if resume_value is None:
            payload: Any = {"vars": dict(run.input), "trace": []}
            run.started_at = datetime.now(UTC)
            await sink.emit("run_start", input=run.input)
        elif resume_value is CONTINUE:
            payload = None
            run.started_at = datetime.now(UTC)
            await sink.emit(
                "run_fork", from_checkpoint=run.fork_checkpoint_id, head=run.head_checkpoint_id
            )
        else:
            payload = Command(resume=resume_value)
            await sink.emit("run_resume", value=resume_value)
            # LangGraph re-enters the interrupted node from the top on resume, so that node
            # would report a second node_start. The first one is already in the log.
            skip_start = (run.interrupt or {}).get("node")

        run.status, run.interrupt = "running", None
        await db.commit()
        bus.publish(run_id, {"seq": None, "type": "status", "status": "running"})

        try:
            stream = graph.astream(
                payload, start_config, stream_mode=["custom", "updates", "messages"]
            )
            async for mode, chunk in stream:
                if mode == "custom":
                    ev = dict(chunk)
                    type_, node = ev.pop("type"), ev.pop("node", None)
                    if type_ == "node_start" and node == skip_start:
                        skip_start = None
                        continue
                    await sink.emit(type_, node, **ev)

                elif mode == "messages":
                    msg, meta = chunk
                    text = msg.content if isinstance(msg.content, str) else ""
                    if text:
                        sink.live("token", meta.get("langgraph_node"), text=text)

                elif mode == "updates":
                    if "__interrupt__" in chunk:
                        intr = chunk["__interrupt__"][0].value
                        run.status, run.interrupt = "paused", intr
                        run.head_checkpoint_id = (await graph.aget_state(config)).config[
                            "configurable"
                        ]["checkpoint_id"]
                        await sink.emit("interrupt", intr.get("node"), **intr)
                        await db.commit()
                        bus.publish(run_id, {"seq": None, "type": "status", "status": "paused"})
                        owner = await db.get(Graph, run.graph_id)
                        telegram.notify_paused(
                            owner.telegram_chat_id if owner else None,
                            run_id,
                            spec.id,
                            spec.name,
                            intr,
                        )
                        return
                    # one checkpoint per completed node: the handle time-travel will use later
                    state = await graph.aget_state(config)
                    run.head_checkpoint_id = state.config["configurable"]["checkpoint_id"]
                    for node in chunk:
                        await sink.emit("checkpoint", node, checkpoint_id=run.head_checkpoint_id)

            state = await graph.aget_state(config)
            run.head_checkpoint_id = state.config["configurable"]["checkpoint_id"]
            run.output = state.values.get("vars", {})
            run.usage = _sum_usage(state.values.get("trace", []))
            run.status = "done"
            run.finished_at = datetime.now(UTC)
            await sink.emit("run_end", output=run.output, usage=run.usage)
        except asyncio.CancelledError:
            run.status, run.finished_at = "cancelled", datetime.now(UTC)
            await sink.emit("run_cancelled")
        except Exception as e:  # noqa: BLE001 - any failure ends the run with a message
            run.status, run.error = "error", f"{type(e).__name__}: {e}"
            run.finished_at = datetime.now(UTC)
            await sink.emit("run_error", error=run.error)
        await db.commit()
        bus.publish(run_id, {"seq": None, "type": "status", "status": run.status})
        await _export(db, run_id)


async def _export(db: AsyncSession, run_id: uuid.UUID) -> None:
    """Push the finished run to Langfuse (no-op without keys). Never raises."""
    if not langfuse_export.enabled():
        return
    rows = (
        (await db.execute(select(RunEvent).where(RunEvent.run_id == run_id).order_by(RunEvent.seq)))
        .scalars()
        .all()
    )
    await asyncio.to_thread(langfuse_export.export_run, run_id, rows)
