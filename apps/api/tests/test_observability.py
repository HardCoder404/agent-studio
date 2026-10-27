import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from app.llm.provider import ainvoke_with_retry
from app.observability import langfuse_export
from app.observability.trace import build_trace, to_otel_json

T0 = datetime(2026, 10, 27, 12, 0, 0, tzinfo=UTC)


def ev(seq, type_, node=None, secs=0.0, **payload):
    return SimpleNamespace(
        seq=seq, type=type_, node_id=node, ts=T0 + timedelta(seconds=secs), payload=payload
    )


EVENTS = [
    ev(1, "run_start", secs=0, input={"topic": "t"}),
    ev(2, "node_start", "write", 0.1),
    ev(3, "retry", "write", 0.2, attempt=1, wait_s=1.0, reason="RateLimitError: 429"),
    ev(
        4,
        "node_end",
        "write",
        0.6,
        output={"draft": "x"},
        usage={
            "model": "m",
            "input_tokens": 10,
            "output_tokens": 5,
            "cost_usd": 0.001,
            "latency_ms": 500,
        },
    ),
    ev(5, "node_start", "review", 0.6),
    ev(6, "interrupt", "review", 0.6, question="ok?"),
    ev(7, "run_resume", secs=5.6, value="yes"),
    ev(8, "node_end", "review", 5.7, output={"decision": "yes"}),
    ev(9, "run_end", secs=5.8, output={"draft": "x"}, usage={"llm_calls": 1}),
]


def test_build_trace_spans():
    rid = uuid.uuid4()
    spans = build_trace(rid, EVENTS)
    assert spans[0].name == "run" and spans[0].parent_id is None
    assert (spans[0].end - spans[0].start).total_seconds() == pytest.approx(5.8)
    names = [(s.kind, s.name) for s in spans[1:]]
    assert names == [
        ("retry", "retry write"),
        ("node", "write"),
        ("node", "review"),
        ("wait", "waiting for human (review)"),
    ]
    write = next(s for s in spans if s.name == "write")
    assert write.attributes["gen_ai.request.model"] == "m" and write.attributes["cost.usd"] == 0.001
    assert all(s.parent_id == spans[0].span_id for s in spans[1:])
    assert build_trace(rid, EVENTS) == spans  # deterministic ids


def test_otel_json_shape():
    rid = uuid.uuid4()
    doc = to_otel_json(rid, build_trace(rid, EVENTS))
    spans = doc["resourceSpans"][0]["scopeSpans"][0]["spans"]
    assert all(s["traceId"] == rid.hex for s in spans)
    assert "parentSpanId" not in spans[0] and all("parentSpanId" in s for s in spans[1:])
    assert int(spans[0]["endTimeUnixNano"]) > int(spans[0]["startTimeUnixNano"])
    retry = next(s for s in spans if s["name"].startswith("retry"))
    assert retry["status"]["code"] == 2
    keys = {a["key"] for a in spans[2]["attributes"]}
    assert {"span.kind", "node.id", "gen_ai.request.model"} <= keys


class FakeObs:
    def __init__(self, log, **kw):
        self.log, self.kw = log, kw
        log.append(("start", kw.get("name"), kw.get("as_type")))  # always 3-tuples

    def update(self, **kw):
        self.log.append(("update", self.kw.get("name"), kw))

    def end(self, **kw):
        self.log.append(("end", self.kw.get("name"), kw))

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.log.append(("exit", self.kw.get("name"), None))


class FakeLangfuse:
    def __init__(self):
        self.log, self.scores, self.flushed = [], [], 0

    def start_as_current_observation(self, **kw):
        return FakeObs(self.log, **kw)

    def start_observation(self, **kw):
        return FakeObs(self.log, **kw)

    def create_score(self, **kw):
        self.scores.append(kw)

    def flush(self):
        self.flushed += 1


def test_langfuse_export_with_fake_client():
    rid = uuid.uuid4()
    lf = FakeLangfuse()
    n = langfuse_export.export_run(rid, EVENTS, lf)
    assert n == 5 and lf.flushed == 1
    starts = [(name, kind) for op, name, kind in lf.log if op == "start"]
    assert (
        ("run", "span") in starts
        and ("write", "generation") in starts
        and ("review", "span") in starts
    )
    gen_update = next(
        kw for op, name, kw in lf.log if op == "update" and name == "write" and "model" in kw
    )
    assert gen_update["usage_details"] == {"input": 10, "output": 5}
    assert (
        langfuse_export.export_scores(
            rid, {"contains:draft": {"score": 1.0, "passed": True, "detail": ""}}, lf
        )
        == 1
    )
    assert lf.scores[0]["trace_id"] == rid.hex


def test_export_disabled_without_keys():
    assert not langfuse_export.enabled()
    assert langfuse_export.trace_url(uuid.uuid4()) is None
    assert langfuse_export.export_run(uuid.uuid4(), EVENTS) == 0


async def test_ainvoke_with_retry_reports_and_recovers(monkeypatch):
    from langchain_core.messages import AIMessage

    calls, reported = [], []

    class Flaky:
        async def ainvoke(self, messages):
            calls.append(1)
            if len(calls) < 3:
                raise ConnectionError("boom")
            return AIMessage(content="ok")

    monkeypatch.setattr("app.llm.provider.RETRYABLE", (ConnectionError,))
    monkeypatch.setattr("asyncio.sleep", lambda s: _noop())
    msg = await ainvoke_with_retry(
        Flaky(), "hi", on_retry=lambda a, w, r: reported.append((a, w, r))
    )
    assert msg.content == "ok" and len(calls) == 3
    assert [a for a, _, _ in reported] == [1, 2] and all("boom" in r for _, _, r in reported)
    with pytest.raises(ConnectionError):
        calls.clear()
        await ainvoke_with_retry(Flaky(), "hi", attempts=2)


async def _noop():
    return None
