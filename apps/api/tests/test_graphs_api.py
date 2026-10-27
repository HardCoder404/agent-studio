import json
from pathlib import Path

EXAMPLE = json.loads(
    (Path(__file__).resolve().parents[3] / "examples" / "tweet-review.json").read_text()
)


async def test_crud_roundtrip(client):
    r = await client.post("/graphs", json=EXAMPLE)
    assert r.status_code == 201, r.text
    created = r.json()
    gid = created["id"]
    assert created["version"] == 1

    r = await client.get("/graphs")
    assert [g["id"] for g in r.json()] == [gid]
    assert r.json()[0]["nodes"] == 6

    r = await client.get(f"/graphs/{gid}")
    assert r.json()["name"] == EXAMPLE["name"]

    updated = {**EXAMPLE, "name": "renamed"}
    r = await client.put(f"/graphs/{gid}", json=updated)
    assert r.status_code == 200
    assert r.json()["version"] == 2
    assert r.json()["name"] == "renamed"

    r = await client.delete(f"/graphs/{gid}")
    assert r.status_code == 204
    assert (await client.get(f"/graphs/{gid}")).status_code == 404


async def test_invalid_graph_is_422(client):
    bad = {**EXAMPLE, "edges": EXAMPLE["edges"][:-1]}  # rewrite node loses its outgoing edge
    r = await client.post("/graphs", json=bad)
    assert r.status_code == 422
    assert "exactly one outgoing edge" in r.text


async def test_models_list(client):
    r = await client.get("/models")
    assert r.status_code == 200
    ids = {m["id"] for m in r.json()}
    assert "groq/openai/gpt-oss-20b" in ids
