"""Push a finished run (and eval scores) to Langfuse, when keys are configured.

Everything is derived from persisted events, so exporting never touches the executor and
can be re-run for any old run.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from app.observability.trace import Span, build_trace
from app.settings import settings

log = logging.getLogger(__name__)
_client: Any = None


def enabled() -> bool:
    return bool(settings.langfuse_public_key and settings.langfuse_secret_key)


def client():
    global _client
    if _client is None and enabled():
        from langfuse import Langfuse

        _client = Langfuse(
            public_key=settings.langfuse_public_key,
            secret_key=settings.langfuse_secret_key,
            host=settings.langfuse_host,
        )
    return _client


def trace_url(run_id: uuid.UUID) -> str | None:
    if not enabled():
        return None
    return f"{settings.langfuse_host.rstrip('/')}/trace/{_trace_id(run_id)}"


def _trace_id(run_id: uuid.UUID) -> str:
    return run_id.hex  # 32 hex chars, exactly what Langfuse expects


def export_spans(run_id: uuid.UUID, spans: list[Span], lf: Any = None) -> int:
    """Create one observation per span. Returns how many were sent. `lf` is injectable for tests."""
    lf = lf or client()
    if lf is None or not spans:
        return 0
    root = spans[0]
    trace_id = _trace_id(run_id)
    with lf.start_as_current_observation(
        as_type="span",
        name="run",
        trace_context={"trace_id": trace_id},
        input=root.attributes.get("run.input"),
        start_time=root.start,
    ) as root_obs:
        root_obs.update(
            output=root.attributes.get("run.output"),
            metadata={"run_id": str(run_id), "status": root.status},
            end_time=root.end,
        )
        for s in spans[1:]:
            is_gen = "gen_ai.request.model" in s.attributes
            obs = lf.start_observation(
                as_type="generation" if is_gen else "span",
                name=s.name,
                start_time=s.start,
                input=s.attributes.get("node.input"),
                metadata={k: v for k, v in s.attributes.items() if k not in ("node.output",)},
            )
            if is_gen:
                obs.update(
                    model=s.attributes.get("gen_ai.request.model"),
                    usage_details={
                        "input": s.attributes.get("gen_ai.usage.input_tokens") or 0,
                        "output": s.attributes.get("gen_ai.usage.output_tokens") or 0,
                    },
                    cost_details={"total": s.attributes.get("cost.usd") or 0},
                )
            obs.update(
                output=s.attributes.get("node.output"),
                level="ERROR" if s.status == "error" else "DEFAULT",
            )
            obs.end(end_time=s.end)
    lf.flush()
    return len(spans)


def export_run(run_id: uuid.UUID, events: list, lf: Any = None) -> int:
    try:
        return export_spans(run_id, build_trace(run_id, events), lf)
    except Exception as e:  # noqa: BLE001 - observability must never break a run
        log.warning("langfuse export failed for run %s: %s", run_id, e)
        return 0


def export_scores(run_id: uuid.UUID, scores: dict[str, dict], lf: Any = None) -> int:
    """Attach eval scores to the run's trace."""
    lf = lf or client()
    if lf is None:
        return 0
    n = 0
    for name, sc in scores.items():
        try:
            lf.create_score(
                trace_id=_trace_id(run_id),
                name=name,
                value=float(sc.get("score", 0)),
                comment=sc.get("detail") or None,
            )
            n += 1
        except Exception as e:  # noqa: BLE001
            log.warning("langfuse score failed: %s", e)
    if n:
        lf.flush()
    return n
