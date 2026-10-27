"""Build a trace (root span + one span per node step) from a run's persisted events.

Both exporters consume this: the OpenTelemetry-style JSON endpoint and the Langfuse push.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass
class Span:
    span_id: str
    parent_id: str | None
    name: str
    kind: str  # run | node | wait | retry
    start: datetime
    end: datetime
    attributes: dict[str, Any] = field(default_factory=dict)
    status: str = "ok"  # ok | error


def _ts(e) -> datetime | None:
    return e.ts if hasattr(e, "ts") else None


def _span_id(run_id: uuid.UUID, seq: int) -> str:
    # deterministic 16-hex span ids: same run + same event always maps to the same id
    return uuid.uuid5(run_id, str(seq)).hex[:16]


def build_trace(run_id: uuid.UUID, events: list) -> list[Span]:
    """`events` are RunEvent rows ordered by seq. Returns the root span first."""
    timed = [e for e in events if _ts(e) is not None]
    if not timed:
        return []
    root = Span(
        span_id=_span_id(run_id, 0),
        parent_id=None,
        name="run",
        kind="run",
        start=timed[0].ts,
        end=timed[-1].ts,
        attributes={"run.id": str(run_id)},
    )
    spans = [root]
    open_nodes: dict[str, tuple[int, datetime]] = {}
    wait: tuple[int, datetime, str] | None = None
    for e in timed:
        p = e.payload or {}
        if e.type == "run_start":
            root.attributes["run.input"] = p.get("input")
        elif e.type == "node_start" and e.node_id:
            open_nodes[e.node_id] = (e.seq, e.ts)
        elif e.type == "node_end" and e.node_id and e.node_id in open_nodes:
            seq, start = open_nodes.pop(e.node_id)
            usage = p.get("usage") or {}
            attrs: dict[str, Any] = {"node.id": e.node_id, "node.output": p.get("output")}
            if usage.get("model"):
                attrs.update(
                    {
                        "gen_ai.request.model": usage["model"],
                        "gen_ai.usage.input_tokens": usage.get("input_tokens"),
                        "gen_ai.usage.output_tokens": usage.get("output_tokens"),
                        "cost.usd": usage.get("cost_usd"),
                    }
                )
            spans.append(
                Span(_span_id(run_id, seq), root.span_id, e.node_id, "node", start, e.ts, attrs)
            )
        elif e.type == "interrupt":
            wait = (e.seq, e.ts, e.node_id or "")
            if e.node_id in open_nodes:  # the human node itself is not "running" while we wait
                seq, start = open_nodes.pop(e.node_id)
                spans.append(
                    Span(
                        _span_id(run_id, seq),
                        root.span_id,
                        e.node_id,
                        "node",
                        start,
                        e.ts,
                        {"node.id": e.node_id},
                    )
                )
        elif e.type == "run_resume" and wait:
            seq, start, node = wait
            spans.append(
                Span(
                    _span_id(run_id, seq),
                    root.span_id,
                    f"waiting for human ({node})",
                    "wait",
                    start,
                    e.ts,
                    {"node.id": node, "human.answer": p.get("value")},
                )
            )
            wait = None
        elif e.type == "retry" and e.node_id:
            spans.append(
                Span(
                    _span_id(run_id, e.seq),
                    root.span_id,
                    f"retry {e.node_id}",
                    "retry",
                    e.ts,
                    e.ts,
                    {
                        "node.id": e.node_id,
                        "retry.attempt": p.get("attempt"),
                        "retry.reason": p.get("reason"),
                    },
                    status="error",
                )
            )
        elif e.type == "run_error":
            root.status = "error"
            root.attributes["error"] = p.get("error")
        elif e.type == "run_end":
            root.attributes["run.output"] = p.get("output")
            root.attributes["run.usage"] = p.get("usage")
    for node, (seq, start) in open_nodes.items():  # still running / crashed mid-node
        spans.append(
            Span(
                _span_id(run_id, seq),
                root.span_id,
                node,
                "node",
                start,
                timed[-1].ts,
                {"node.id": node},
                status="error" if root.status == "error" else "ok",
            )
        )
    return spans


def to_otel_json(run_id: uuid.UUID, spans: list[Span]) -> dict:
    """OpenTelemetry-shaped JSON (OTLP/JSON layout) so the trace can be loaded into Jaeger-style tools."""
    trace_id = run_id.hex

    def attr(k: str, v: Any) -> dict:
        if isinstance(v, bool):
            return {"key": k, "value": {"boolValue": v}}
        if isinstance(v, int):
            return {"key": k, "value": {"intValue": str(v)}}
        if isinstance(v, float):
            return {"key": k, "value": {"doubleValue": v}}
        if isinstance(v, str):
            return {"key": k, "value": {"stringValue": v}}
        import json

        return {"key": k, "value": {"stringValue": json.dumps(v, ensure_ascii=False, default=str)}}

    ns = lambda d: str(int(d.timestamp() * 1e9))
    return {
        "resourceSpans": [
            {
                "resource": {"attributes": [attr("service.name", "agent-studio")]},
                "scopeSpans": [
                    {
                        "scope": {"name": "agent-studio.runs"},
                        "spans": [
                            {
                                "traceId": trace_id,
                                "spanId": s.span_id,
                                **({"parentSpanId": s.parent_id} if s.parent_id else {}),
                                "name": s.name,
                                "kind": 1,
                                "startTimeUnixNano": ns(s.start),
                                "endTimeUnixNano": ns(s.end),
                                "attributes": [
                                    attr("span.kind", s.kind),
                                    *(attr(k, v) for k, v in s.attributes.items() if v is not None),
                                ],
                                "status": {"code": 2 if s.status == "error" else 1},
                            }
                            for s in spans
                        ],
                    }
                ],
            }
        ]
    }
