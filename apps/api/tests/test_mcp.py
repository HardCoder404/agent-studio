import sys
from pathlib import Path

from app.engine import checkpointer
from app.engine import tools as tool_registry
from app.engine.mcp import ServerConfig, manager

DEMO = str(Path(__file__).with_name("mcp_demo_server.py"))


async def test_manager_connects_lists_and_calls():
    tools = await manager.connect(ServerConfig("demo", "stdio", sys.executable, [DEMO]))
    try:
        assert {t.name for t in tools} == {"add", "shout"}
        assert tools[0].input_schema["type"] == "object"
        assert await manager.call("demo", "add", {"a": 2, "b": 3}) == 5
        assert await manager.call("demo", "shout", {"text": "hi"}) == "HI!"
        assert manager.status("demo") == "connected"
        names = {t["name"] for t in tool_registry.list_tools()}
        assert "mcp:demo:add" in names
        fn = tool_registry.get_tool("mcp:demo:shout")
        assert await fn(text="yo") == "YO!"
    finally:
        await manager.disconnect("demo")
    assert manager.status("demo") == "disconnected"
    assert "mcp:demo:add" not in {t["name"] for t in tool_registry.list_tools()}


async def test_connect_failure_is_reported():
    import pytest

    with pytest.raises((OSError, RuntimeError, ValueError, TimeoutError)):
        await manager.connect(ServerConfig("broken", "stdio", "definitely-not-a-command-xyz", []))
    assert manager.status("broken") == "disconnected"


async def test_mcp_server_api_and_tool_node(client):
    checkpointer.use_memory()
    r = await client.post(
        "/mcp/servers",
        json={"name": "demo", "transport": "stdio", "command": sys.executable, "args": [DEMO]},
    )
    assert r.status_code == 201, r.text
    srv = r.json()
    assert srv["status"] == "connected" and [t["name"] for t in srv["tools"]] == ["add", "shout"]
    assert any(
        t["name"] == "mcp:demo:add" and t["server"] == "demo" and t["schema"]
        for t in (await client.get("/tools")).json()
    )

    graph = {
        "name": "mcp",
        "nodes": [
            {"id": "s", "type": "start"},
            {
                "id": "t",
                "type": "tool",
                "config": {
                    "tool": "mcp:demo:shout",
                    "args": {"text": "{{word}}"},
                    "output_key": "loud",
                },
            },
            {"id": "e", "type": "end"},
        ],
        "edges": [
            {"id": "1", "source": "s", "target": "t"},
            {"id": "2", "source": "t", "target": "e"},
        ],
    }
    gid = (await client.post("/graphs", json=graph)).json()["id"]
    rid = (
        await client.post("/runs", json={"graph_id": gid, "input": {"word": "mcp works"}})
    ).json()["id"]
    from tests.test_runs_api import wait_for

    run = await wait_for(client, rid, "done")
    assert run["status"] == "done", run
    assert run["output"]["loud"] == "MCP WORKS!"

    assert (
        await client.post(
            "/mcp/servers", json={"name": "demo", "transport": "stdio", "command": "x"}
        )
    ).status_code == 409
    assert (await client.post(f"/mcp/servers/{srv['id']}/refresh")).json()["status"] == "connected"
    assert (await client.delete(f"/mcp/servers/{srv['id']}")).status_code == 204
    assert (await client.get("/mcp/servers")).json() == []
    assert manager.status("demo") == "disconnected"
