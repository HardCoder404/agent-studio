import json
from pathlib import Path

from app.engine import checkpointer
from tests.fakes import script

EXAMPLE = json.loads(
    (Path(__file__).resolve().parents[3] / "examples" / "tweet-review.json").read_text()
)


async def test_run_pause_resume_done(client, monkeypatch):
    checkpointer.use_memory()
    script(monkeypatch, ["draft one", "draft two"])
    gid = (await client.post("/graphs", json=EXAMPLE)).json()["id"]

    r = await client.post("/runs", json={"graph_id": gid, "input": {"topic": "debugging agents"}})
    assert r.status_code == 202, r.text
    rid = r.json()["id"]

    run = (await client.get(f"/runs/{rid}")).json()  # background task has finished by now
    assert run["status"] == "paused"
    assert run["interrupt"]["show"] == {"draft": "draft one"}

    r = await client.post(f"/runs/{rid}/resume", json={"value": "no"})
    assert r.status_code == 202
    run = (await client.get(f"/runs/{rid}")).json()
    assert run["status"] == "paused"
    assert run["interrupt"]["show"] == {"draft": "draft two"}

    await client.post(f"/runs/{rid}/resume", json={"value": "yes"})
    run = (await client.get(f"/runs/{rid}")).json()
    assert run["status"] == "done", run
    assert run["output"]["draft"] == "draft two"
    assert run["usage"]["llm_calls"] == 2
    assert run["usage"]["input_tokens"] == 20

    events = (await client.get(f"/runs/{rid}/events")).json()
    types = [e["type"] for e in events]
    assert types[0] == "run_start" and types[-1] == "run_end"
    assert types.count("interrupt") == 2 and types.count("run_resume") == 2
    nodes_started = [e["node"] for e in events if e["type"] == "node_start"]
    assert nodes_started == ["write", "review", "route", "rewrite", "review", "route"]
    assert [e["seq"] for e in events] == list(range(1, len(events) + 1))

    assert (await client.post(f"/runs/{rid}/resume", json={"value": "x"})).status_code == 409
    assert len((await client.get(f"/runs?graph_id={gid}")).json()) == 1


async def test_run_unknown_graph(client):
    r = await client.post("/runs", json={"graph_id": "00000000-0000-0000-0000-000000000000"})
    assert r.status_code == 404


async def test_tools_list(client):
    names = {t["name"] for t in (await client.get("/tools")).json()}
    assert {"echo", "http_get", "current_time"} <= names
