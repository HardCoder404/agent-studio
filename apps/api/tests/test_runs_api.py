import asyncio
import json
from pathlib import Path

from app.engine import bus, checkpointer
from tests.fakes import script

EXAMPLE = json.loads(
    (Path(__file__).resolve().parents[3] / "examples" / "tweet-review.json").read_text()
)


async def wait_for(client, rid: str, want: str, timeout: float = 5.0) -> dict:
    deadline = asyncio.get_event_loop().time() + timeout
    while True:
        run = (await client.get(f"/runs/{rid}")).json()
        if run["status"] == want or run["status"] in ("error", "cancelled"):
            return run
        assert asyncio.get_event_loop().time() < deadline, f"timed out waiting for {want}: {run}"
        await asyncio.sleep(0.02)


async def test_run_pause_resume_done(client, monkeypatch):
    checkpointer.use_memory()
    script(monkeypatch, ["draft one", "draft two"])
    gid = (await client.post("/graphs", json=EXAMPLE)).json()["id"]

    r = await client.post("/runs", json={"graph_id": gid, "input": {"topic": "debugging agents"}})
    assert r.status_code == 202, r.text
    rid = r.json()["id"]

    run = await wait_for(client, rid, "paused")
    assert run["interrupt"]["show"] == {"draft": "draft one"}
    assert run["started_at"] is not None and run["duration_ms"] is not None

    assert (await client.post(f"/runs/{rid}/resume", json={"value": "no"})).status_code == 202
    run = await wait_for(client, rid, "paused")
    assert run["interrupt"]["show"] == {"draft": "draft two"}

    await client.post(f"/runs/{rid}/resume", json={"value": "yes"})
    run = await wait_for(client, rid, "done")
    assert run["status"] == "done", run
    assert run["output"]["draft"] == "draft two"
    assert run["usage"]["llm_calls"] == 2
    assert run["usage"]["input_tokens"] == 20
    assert run["finished_at"] is not None

    events = (await client.get(f"/runs/{rid}/events")).json()
    types = [e["type"] for e in events]
    assert types[0] == "run_start" and types[-1] == "run_end"
    assert types.count("interrupt") == 2 and types.count("run_resume") == 2
    assert "token" not in types  # tokens are live-only, never persisted
    nodes_started = [e["node"] for e in events if e["type"] == "node_start"]
    assert nodes_started == ["write", "review", "route", "rewrite", "review", "route"]
    assert [e["seq"] for e in events] == list(range(1, len(events) + 1))
    checkpoints = [e for e in events if e["type"] == "checkpoint"]
    assert len(checkpoints) >= 5 and all(e["checkpoint_id"] for e in checkpoints)

    assert (await client.post(f"/runs/{rid}/resume", json={"value": "x"})).status_code == 409
    assert (await client.post(f"/runs/{rid}/cancel")).status_code == 409
    assert len((await client.get(f"/runs?graph_id={gid}")).json()) == 1
    assert len((await client.get("/runs?status_=done")).json()) == 1


async def test_live_bus_gets_tokens(client, monkeypatch):
    checkpointer.use_memory()
    script(monkeypatch, ["hello streaming world", "x"])
    gid = (await client.post("/graphs", json=EXAMPLE)).json()["id"]

    received: list[dict] = []

    async def listen(rid_box: dict):
        async with bus.subscribe(rid_box["id"]) as q:
            while True:
                ev = await q.get()
                received.append(ev)
                if ev.get("type") == "status" and ev.get("status") == "paused":
                    return

    import uuid

    rid_box = {"id": None}
    # subscribe needs the run id; create the row first then immediately listen
    r = await client.post("/runs", json={"graph_id": gid, "input": {"topic": "t"}})
    rid_box["id"] = uuid.UUID(r.json()["id"])
    listener = asyncio.create_task(listen(rid_box))
    await wait_for(client, str(rid_box["id"]), "paused")
    await asyncio.wait_for(listener, 2)

    tokens = "".join(e["text"] for e in received if e["type"] == "token" and e["node"] == "write")
    assert tokens == "hello streaming world"
    assert [e["type"] for e in received if e["seq"]][-1] == "interrupt"


async def test_cancel_paused_run(client, monkeypatch):
    checkpointer.use_memory()
    script(monkeypatch, ["d"])
    gid = (await client.post("/graphs", json=EXAMPLE)).json()["id"]
    rid = (await client.post("/runs", json={"graph_id": gid, "input": {"topic": "t"}})).json()["id"]
    await wait_for(client, rid, "paused")
    assert (await client.post(f"/runs/{rid}/cancel")).json()["status"] == "cancelled"
    assert (await client.post(f"/runs/{rid}/resume", json={"value": "yes"})).status_code == 409


async def test_run_unknown_graph(client):
    r = await client.post("/runs", json={"graph_id": "00000000-0000-0000-0000-000000000000"})
    assert r.status_code == 404


async def test_tools_list(client):
    names = {t["name"] for t in (await client.get("/tools")).json()}
    assert {"echo", "http_get", "current_time"} <= names


async def test_checkpoints_history(client, monkeypatch):
    checkpointer.use_memory()
    script(monkeypatch, ["d1", "d2"])
    gid = (await client.post("/graphs", json=EXAMPLE)).json()["id"]
    rid = (await client.post("/runs", json={"graph_id": gid, "input": {"topic": "t"}})).json()["id"]
    await wait_for(client, rid, "paused")
    await client.post(f"/runs/{rid}/resume", json={"value": "yes"})
    await wait_for(client, rid, "done")

    cps = (await client.get(f"/runs/{rid}/checkpoints")).json()
    assert [c["node"] for c in cps] == [None, "start", "write", "review", "route", "end"]
    assert cps[0]["vars"] == {"topic": "t"}
    assert cps[2]["vars"]["draft"] == "d1"
    assert "decision" not in cps[2]["vars"] and cps[3]["vars"]["decision"] == "yes"
    assert cps[-1]["next"] == []
    assert all(c["checkpoint_id"] for c in cps)
    assert cps[1]["parent_id"] == cps[0]["checkpoint_id"]
    # the executor's checkpoint events point at ids that exist in the history
    events = (await client.get(f"/runs/{rid}/events")).json()
    ids = {c["checkpoint_id"] for c in cps}
    assert all(e["checkpoint_id"] in ids for e in events if e["type"] == "checkpoint")


async def test_fork_from_checkpoint(client, monkeypatch):
    checkpointer.use_memory()
    script(monkeypatch, ["original draft", "rewritten", "unused"])
    gid = (await client.post("/graphs", json=EXAMPLE)).json()["id"]
    rid = (await client.post("/runs", json={"graph_id": gid, "input": {"topic": "t"}})).json()["id"]
    await wait_for(client, rid, "paused")
    await client.post(f"/runs/{rid}/resume", json={"value": "yes"})
    original = await wait_for(client, rid, "done")
    assert original["output"]["draft"] == "original draft"
    assert original["head_checkpoint_id"]

    cps = (await client.get(f"/runs/{rid}/checkpoints")).json()
    after_write = next(c for c in cps if c["node"] == "write")

    # edit the draft at that point and branch
    r = await client.post(
        f"/runs/{rid}/fork",
        json={
            "checkpoint_id": after_write["checkpoint_id"],
            "vars": {"draft": "hand-edited draft"},
        },
    )
    assert r.status_code == 202, r.text
    fork = r.json()
    assert (
        fork["parent_run_id"] == rid and fork["fork_checkpoint_id"] == after_write["checkpoint_id"]
    )

    fork = await wait_for(client, fork["id"], "paused")  # continues into the human review
    assert fork["interrupt"]["show"] == {"draft": "hand-edited draft"}
    await client.post(f"/runs/{fork['id']}/resume", json={"value": "yes"})
    fork = await wait_for(client, fork["id"], "done")
    assert fork["output"]["draft"] == "hand-edited draft"

    # original is untouched, fork lineage shows the edit
    assert (await client.get(f"/runs/{rid}")).json()["output"]["draft"] == "original draft"
    fcps = (await client.get(f"/runs/{fork['id']}/checkpoints")).json()
    assert [c["node"] for c in fcps] == [None, "start", "write", None, "review", "route", "end"]
    assert [c["forked"] for c in fcps].count(True) == 1
    assert (
        fcps[3]["vars"]["draft"] == "hand-edited draft"
        and fcps[2]["vars"]["draft"] == "original draft"
    )
    orig_cps = (await client.get(f"/runs/{rid}/checkpoints")).json()
    assert [c["node"] for c in orig_cps] == [None, "start", "write", "review", "route", "end"]

    events = (await client.get(f"/runs/{fork['id']}/events")).json()
    assert events[0]["type"] == "run_fork"

    # forking from the end is refused
    r = await client.post(
        f"/runs/{rid}/fork", json={"checkpoint_id": orig_cps[-1]["checkpoint_id"]}
    )
    assert r.status_code == 409
    assert (
        await client.post(f"/runs/{rid}/fork", json={"checkpoint_id": "nope"})
    ).status_code == 404


async def test_trace_endpoint(client, monkeypatch):
    checkpointer.use_memory()
    script(monkeypatch, ["d"])
    gid = (await client.post("/graphs", json=EXAMPLE)).json()["id"]
    rid = (await client.post("/runs", json={"graph_id": gid, "input": {"topic": "t"}})).json()["id"]
    await wait_for(client, rid, "paused")
    await client.post(f"/runs/{rid}/resume", json={"value": "yes"})
    await wait_for(client, rid, "done")
    doc = (await client.get(f"/runs/{rid}/trace")).json()
    spans = doc["resourceSpans"][0]["scopeSpans"][0]["spans"]
    assert spans[0]["name"] == "run" and spans[0]["traceId"] == rid.replace("-", "")
    assert {s["name"] for s in spans} >= {
        "run",
        "write",
        "review",
        "route",
        "waiting for human (review)",
    }
    assert (await client.get(f"/runs/{rid}")).json()[
        "trace_url"
    ] is None  # no Langfuse keys in tests
