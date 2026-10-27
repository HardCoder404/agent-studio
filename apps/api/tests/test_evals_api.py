import asyncio
import json
from pathlib import Path

import pytest

from app.engine import checkpointer
from tests.fakes import script

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
    # three rows; the fake model answers drafts in order, and the judge scripted replies come after
    script(monkeypatch, ["draft about cats", "draft about dogs", "draft about owls"])
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
