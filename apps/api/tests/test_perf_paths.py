import pytest

from app.routers import graphs as graphs_router


@pytest.mark.anyio
async def test_catalog_endpoints_are_cacheable(client):
    for path, expect in (
        ("/models", "max-age=300"),
        ("/templates", "max-age=300"),
        ("/templates/tweet-review", "max-age=300"),
        ("/health", "max-age=10"),
    ):
        r = await client.get(path)
        assert r.status_code == 200, path
        assert expect in r.headers.get("cache-control", ""), path
    assert "cache-control" not in (await client.get("/graphs")).headers
    assert "cache-control" not in (await client.get("/tools")).headers


@pytest.mark.anyio
async def test_runs_summary_blanks_blobs(client):
    g = (await client.post("/graphs/from-template/tweet-review")).json()
    r = await client.post("/runs", json={"graph_id": g["id"], "input": {"topic": "x" * 500}})
    assert r.status_code == 202
    full = (await client.get("/runs?limit=5")).json()[0]
    summary = (await client.get("/runs?limit=5&fields=summary")).json()[0]
    assert full["input"]["topic"].startswith("xxx")
    assert summary["input"] == {} and summary["output"] is None and summary["error"] is None
    assert summary["id"] == full["id"] and summary["status"] == full["status"]
    assert summary["usage"] == full["usage"]


@pytest.mark.anyio
async def test_graph_list_counts_follow_edits(client):
    graphs_router._summary_cache.clear()
    g = (await client.post("/graphs/from-template/tweet-review")).json()
    before = next(x for x in (await client.get("/graphs")).json() if x["id"] == g["id"])
    assert before["issues"] == 0
    broken = {k: g[k] for k in ("name", "description", "nodes", "edges")}
    broken["edges"] = broken["edges"][1:]  # drop one edge -> lint issue
    assert (await client.put(f"/graphs/{g['id']}", json=broken)).status_code == 200
    after = next(x for x in (await client.get("/graphs")).json() if x["id"] == g["id"])
    assert after["issues"] > 0 and after["version"] == before["version"] + 1
