async def test_templates_duplicate_and_share(client):
    templates = (await client.get("/templates")).json()
    assert {"tweet-review", "research-critic", "support-triage", "pr-review"} <= {
        t["id"] for t in templates
    }
    assert all(t["description"] for t in templates)

    r = await client.post("/graphs/from-template/support-triage")
    assert r.status_code == 201 and r.json()["issues"] == []
    gid = r.json()["id"]
    assert (await client.post("/graphs/from-template/nope")).status_code == 404

    dup = (await client.post(f"/graphs/{gid}/duplicate")).json()
    assert (
        dup["id"] != gid
        and dup["name"].endswith("(copy)")
        and len(dup["nodes"]) == len(r.json()["nodes"])
    )

    tok = (await client.post(f"/graphs/{gid}/share")).json()["token"]
    assert len(tok) > 20
    assert (await client.post(f"/graphs/{gid}/share")).json()["token"] == tok
    shared = (await client.get(f"/share/{tok}")).json()
    assert shared["shared"] is True and shared["name"].startswith("Support")
    assert next(g for g in (await client.get("/graphs")).json() if g["id"] == gid)["shared"] is True

    forked = (await client.post(f"/share/{tok}/fork")).json()
    assert forked["id"] not in (gid, dup["id"])

    assert (await client.delete(f"/graphs/{gid}/share")).status_code == 204
    assert (await client.get(f"/share/{tok}")).status_code == 404
