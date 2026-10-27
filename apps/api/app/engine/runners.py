"""One runner factory per node type. A runner is a plain async function: state in, partial state out.

Each runner emits `node_start` / `node_end` custom stream events so the API can show
progress without depending on LangGraph's internal event names.
"""

import json
import time
from collections.abc import Awaitable, Callable
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.config import get_stream_writer
from langgraph.types import interrupt

from app.engine import tools as tool_registry
from app.engine.rules import evaluate
from app.engine.state import RunState
from app.engine.template import render, render_value
from app.llm.provider import ainvoke_with_retry, get_chat_model
from app.llm.usage import usage_from_message
from app.schemas.graph import CodeNode, HumanNode, LLMNode, RouterNode, ToolNode

Runner = Callable[[RunState], Awaitable[dict]]


def _retry_reporter(node_id: str):
    def report(attempt: int, wait_s: float, reason: str) -> None:
        _emit(
            {
                "type": "retry",
                "node": node_id,
                "attempt": attempt,
                "wait_s": wait_s,
                "reason": reason,
            }
        )

    return report


def _emit(event: dict) -> None:
    try:
        get_stream_writer()(event)
    except RuntimeError:  # called outside a graph run (unit tests)
        pass


def make_llm_runner(node: LLMNode) -> Runner:
    cfg = node.config

    async def run(state: RunState) -> dict:
        _emit({"type": "node_start", "node": node.id})
        llm = get_chat_model(cfg.model, temperature=cfg.temperature, max_tokens=cfg.max_tokens)
        messages: list = []
        if cfg.system_prompt:
            messages.append(SystemMessage(render(cfg.system_prompt, state["vars"])))
        messages.append(HumanMessage(render(cfg.prompt, state["vars"])))
        t0 = time.perf_counter()
        msg = await ainvoke_with_retry(llm, messages, on_retry=_retry_reporter(node.id))
        usage = usage_from_message(cfg.model, msg)
        text = msg.content if isinstance(msg.content, str) else json.dumps(msg.content)
        entry = {
            "node": node.id,
            "model": cfg.model,
            "latency_ms": round((time.perf_counter() - t0) * 1000),
            **usage.as_dict(),
        }
        _emit(
            {"type": "node_end", "node": node.id, "output": {cfg.output_key: text}, "usage": entry}
        )
        return {"vars": {cfg.output_key: text.strip()}, "trace": [entry]}

    return run


def make_tool_runner(node: ToolNode) -> Runner:
    cfg = node.config
    fn = tool_registry.get_tool(cfg.tool)  # fail at compile time if the tool does not exist

    async def run(state: RunState) -> dict:
        _emit({"type": "node_start", "node": node.id})
        args = render_value(cfg.args, state["vars"])
        t0 = time.perf_counter()
        result = await fn(**args)
        entry = {"node": node.id, "latency_ms": round((time.perf_counter() - t0) * 1000)}
        _emit(
            {
                "type": "node_end",
                "node": node.id,
                "output": {cfg.output_key: result},
                "usage": entry,
            }
        )
        return {"vars": {cfg.output_key: result}, "trace": [entry]}

    return run


def make_human_runner(node: HumanNode) -> Runner:
    cfg = node.config

    async def run(state: RunState) -> dict:
        _emit({"type": "node_start", "node": node.id})
        shown = {k: state["vars"].get(k) for k in cfg.show_keys}
        # Pauses the run. The value passed to Command(resume=...) comes back as `answer`.
        answer = interrupt(
            {"node": node.id, "question": render(cfg.question, state["vars"]), "show": shown}
        )
        _emit({"type": "node_end", "node": node.id, "output": {cfg.output_key: answer}})
        return {"vars": {cfg.output_key: answer}, "trace": [{"node": node.id}]}

    return run


_SAFE_BUILTINS = {
    "len": len, "str": str, "int": int, "float": float, "min": min, "max": max, "sum": sum,
    "sorted": sorted, "range": range, "dict": dict, "list": list, "abs": abs, "round": round,
    "enumerate": enumerate, "zip": zip, "any": any, "all": all, "json": json,
}  # fmt: skip


def make_code_runner(node: CodeNode) -> Runner:
    """In-process execution with a reduced builtins table. Not a sandbox yet: the Docker
    sandbox arrives later and this runner is swapped out for it."""
    cfg = node.config

    async def run(state: RunState) -> dict:
        _emit({"type": "node_start", "node": node.id})
        namespace: dict[str, Any] = {"__builtins__": _SAFE_BUILTINS}
        exec(compile(cfg.source, f"<code:{node.id}>", "exec"), namespace)  # noqa: S102
        main = namespace.get("main")
        if not callable(main):
            raise TypeError(f"code node {node.id}: define `def main(state): ...`")
        t0 = time.perf_counter()
        result = main(dict(state["vars"]))
        if not isinstance(result, dict):
            raise TypeError(f"code node {node.id}: main() must return a dict of variables")
        entry = {"node": node.id, "latency_ms": round((time.perf_counter() - t0) * 1000)}
        _emit({"type": "node_end", "node": node.id, "output": result, "usage": entry})
        return {"vars": result, "trace": [entry]}

    return run


def make_router(node: RouterNode) -> tuple[Runner, Callable[[RunState], Awaitable[str]]]:
    """A router is two things in LangGraph: a (no-op) node, and a conditional-edge function
    that returns the chosen branch label."""
    cfg = node.config
    labels = [b.label for b in cfg.branches]

    async def run(state: RunState) -> dict:
        _emit({"type": "node_start", "node": node.id})
        return {}

    async def decide(state: RunState) -> str:
        vars = state["vars"]
        if cfg.mode == "rule":
            chosen = next((b.label for b in cfg.branches if evaluate(b.when, vars)), labels[-1])
            _emit({"type": "node_end", "node": node.id, "output": {"branch": chosen}})
            return chosen

        llm = get_chat_model(cfg.model, temperature=0, max_tokens=64)
        options = "\n".join(f"- {b.label}: {b.when}" for b in cfg.branches)
        prompt = (
            "Pick exactly one option for the input below. Reply with the option label only.\n\n"
            f"Options:\n{options}\n\nInput:\n{vars.get(cfg.input_key, '')}"
        )
        msg = await ainvoke_with_retry(
            llm, [HumanMessage(prompt)], on_retry=_retry_reporter(node.id)
        )
        raw = (msg.content if isinstance(msg.content, str) else "").strip().strip("\"'").lower()
        chosen = next((lb for lb in labels if lb.lower() == raw), None)
        if chosen is None:  # tolerate "label." or "Label: because..."
            chosen = next((lb for lb in labels if raw.startswith(lb.lower())), labels[-1])
        usage = usage_from_message(cfg.model, msg)
        _emit({
            "type": "node_end", "node": node.id, "output": {"branch": chosen, "raw": raw},
            "usage": {"node": node.id, "model": cfg.model, **usage.as_dict()},
        })  # fmt: skip
        return chosen

    return run, decide
