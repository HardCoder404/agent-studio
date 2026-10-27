import asyncio
import json
import re
from pathlib import Path

import pytest

from app.engine import checkpointer
from tests.fakes import keyed, script

EXAMPLE = json.loads(
    (Path(__file__).resolve().parents[3] / "examples" / "tweet-review.json").read_text()
)


async def wait_eval(client, eid: str, timeout: float = 10.0) -> dict:
    deadline = asyncio.get_event_loop().time() + timeout
    while True:
        ev = (await client.get(f"/evals/{eid}")).json()
        if ev["status"] in ("done", "error", "cancelled"):
            return ev
        assert asyncio.get_event_loop().time() < deadline, ev
        await asyncio.sleep(0.03)


async def test_dataset_crud(client):
    r = await client.post(
        "/datasets", json={"name": "d", "rows": [{"input": {"topic": "a"}, "expected": "x"}]}
    )
    assert r.status_code == 201
    did = r.json()["id"]
    assert (await client.get(f"/datasets/{did}")).json()["rows"][0]["expected"] == "x"
    r = await client.put(f"/datasets/{did}", json={"name": "d2", "rows": []})
    assert r.json()["name"] == "d2" and r.json()["rows"] == []
    assert (await client.delete(f"/datasets/{did}")).status_code == 204
    assert (await client.get(f"/datasets/{did}")).status_code == 404


async def test_eval_end_to_end(client, monkeypatch):
    checkpointer.use_memory()
    monkeypatch.setattr("app.evals.runner.CONCURRENCY", 1)  # in-memory SQLite shares one connection
    # the fake answers from the prompt itself ("about: birds" -> "draft about owls"), so order never matters
    topic = lambda p: (re.search(r"about: (\w+)", p) or re.search(r"(\w+)$", p)).group(1)
    keyed(monkeypatch, lambda p: "draft about " + {"birds": "owls"}.get(topic(p), topic(p)))
    gid = (await client.post("/graphs", json=EXAMPLE)).json()["id"]
    rows = [
        {"input": {"topic": "cats"}, "expected": "cats", "human": "yes"},
        {"input": {"topic": "dogs"}, "expected": "dogs", "human": "yes"},
        {
            "input": {"topic": "birds"},
            "expected": "birds",
            "human": "yes",
        },  # draft says owls -> fails contains
    ]
    did = (
        await client.post("/datasets", json={"graph_id": gid, "name": "topics", "rows": rows})
    ).json()["id"]

    r = await client.post(
        "/evals",
        json={
            "graph_id": gid,
            "dataset_id": did,
            "scorers": [
                {"kind": "contains", "key": "draft"},
                {"kind": "max_length", "key": "draft", "max_chars": 280},
            ],
        },
    )
    assert r.status_code == 202, r.text
    ev = await wait_eval(client, r.json()["id"])
    assert ev["status"] == "done", ev
    assert ev["completed"] == 3 and len(ev["results"]) == 3
    s = ev["summary"]
    assert s["rows"] == 3, s
    assert s["errors"] == 0, [r["error"] for r in ev["results"]]
    assert s["scorers"]["contains:draft"]["pass_rate"] == pytest.approx(2 / 3, abs=1e-3)
    assert s["scorers"]["max_length:draft"]["pass_rate"] == 1.0
    assert s["pass_rate"] == pytest.approx(2 / 3, abs=1e-3)
    assert s["node_failure_share"] == {
        "write": pytest.approx(1 / 3, abs=1e-3),
        "rewrite": pytest.approx(1 / 3, abs=1e-3),
    }  # both write `draft`
    failed = next(r for r in ev["results"] if not r["scores"]["contains:draft"]["passed"])
    assert (
        failed["input"] == {"topic": "birds"}
        and "birds" in failed["scores"]["contains:draft"]["detail"]
    )
    assert all(r["run_id"] for r in ev["results"])
    assert (await client.get(f"/evals?graph_id={gid}")).json()[0]["dataset_name"] == "topics"


async def test_eval_row_without_human_answer_errors(client, monkeypatch):
    checkpointer.use_memory()
    monkeypatch.setattr("app.evals.runner.CONCURRENCY", 1)
    script(monkeypatch, ["d"])
    gid = (await client.post("/graphs", json=EXAMPLE)).json()["id"]
    did = (
        await client.post(
            "/datasets", json={"graph_id": gid, "name": "x", "rows": [{"input": {"topic": "t"}}]}
        )
    ).json()["id"]
    r = await client.post(
        "/evals",
        json={
            "graph_id": gid,
            "dataset_id": did,
            "scorers": [{"kind": "max_length", "key": "draft", "max_chars": 10}],
        },
    )
    ev = await wait_eval(client, r.json()["id"])
    assert ev["summary"]["errors"] == 1
    assert "human" in ev["results"][0]["error"]


async def test_model_sweep_and_recommendation(client, monkeypatch):
    checkpointer.use_memory()
    monkeypatch.setattr("app.evals.runner.CONCURRENCY", 1)
    # every variant drafts correctly, so pass rates tie and the cheapest model wins
    keyed(monkeypatch, lambda p: "draft about " + re.search(r"about: (\w+)", p).group(1))
    gid = (await client.post("/graphs", json=EXAMPLE)).json()["id"]
    rows = [
        {"input": {"topic": "cats"}, "expected": "cats", "human": "yes"},
        {"input": {"topic": "dogs"}, "expected": "dogs", "human": "yes"},
    ]
    did = (
        await client.post("/datasets", json={"graph_id": gid, "name": "t", "rows": rows})
    ).json()["id"]
    r = await client.post(
        "/evals/sweep",
        json={
            "graph_id": gid,
            "dataset_id": did,
            "scorers": [{"kind": "contains", "key": "draft"}],
            "node_id": "write",
            "models": ["groq/openai/gpt-oss-120b", "groq/openai/gpt-oss-20b"],
        },
    )
    assert r.status_code == 202, r.text
    sid = r.json()["sweep_id"]
    assert [e["variant"] for e in r.json()["evals"]] == [
        "groq/openai/gpt-oss-120b",
        "groq/openai/gpt-oss-20b",
    ]
    for _ in range(200):
        sw = (await client.get(f"/evals/sweeps/{sid}")).json()
        if sw["done"]:
            break
        await asyncio.sleep(0.03)
    assert sw["done"] and all(v["status"] == "done" for v in sw["variants"])
    assert all(v["summary"]["pass_rate"] == 1.0 for v in sw["variants"])
    assert sw["recommended"] == "groq/openai/gpt-oss-20b"  # same accuracy, cheaper
    assert (await client.get(f"/evals/sweeps?graph_id={gid}")).json()[0]["models"] == [
        "groq/openai/gpt-oss-120b",
        "groq/openai/gpt-oss-20b",
    ]
    # not an llm node
    r = await client.post(
        "/evals/sweep",
        json={
            "graph_id": gid,
            "dataset_id": did,
            "scorers": [{"kind": "contains", "key": "draft"}],
            "node_id": "review",
            "models": ["groq/openai/gpt-oss-20b"],
        },
    )
    assert r.status_code == 422


async def test_graph_stats(client, monkeypatch):
    checkpointer.use_memory()
    script(monkeypatch, ["d1"])
    gid = (await client.post("/graphs", json=EXAMPLE)).json()["id"]
    assert (await client.get(f"/graphs/{gid}/stats")).json()["runs"] == 0
    from tests.test_runs_api import wait_for

    rid = (await client.post("/runs", json={"graph_id": gid, "input": {"topic": "t"}})).json()["id"]
    await wait_for(client, rid, "paused")
    await client.post(f"/runs/{rid}/resume", json={"value": "yes"})
    await wait_for(client, rid, "done")
    st = (await client.get(f"/graphs/{gid}/stats")).json()
    assert st["runs"] == 1
    assert st["nodes"]["write"]["calls"] == 1 and st["nodes"]["write"]["input_tokens"] == 10
    assert st["models"]["groq/openai/gpt-oss-20b"]["calls"] == 1
    assert st["total"]["calls"] == 1 and st["total"]["p95_ms"] is not None
