"""MCP (Model Context Protocol) client: connect to servers, expose their tools as tool nodes.

Each server gets a worker task that owns the connection. Requests are passed to the worker
through a queue, because the MCP transports use cancel scopes that must be entered and
exited by the same task.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass, field
from typing import Any

from mcp import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client

from app.engine import tools as tool_registry

log = logging.getLogger(__name__)

CONNECT_TIMEOUT = 20
CALL_TIMEOUT = 60


@dataclass
class ServerConfig:
    name: str
    transport: str  # stdio | http
    command: str | None = None
    args: list[str] = field(default_factory=list)
    env: dict[str, str] = field(default_factory=dict)
    url: str | None = None
    headers: dict[str, str] = field(default_factory=dict)


@dataclass
class ToolInfo:
    name: str
    description: str
    input_schema: dict


def tool_id(server: str, tool: str) -> str:
    return f"mcp:{server}:{tool}"


def _result_to_value(result: Any) -> Any:
    """Flatten a CallToolResult into something a graph variable can hold."""
    structured = getattr(result, "structured_content", None)
    if structured:
        # scalar returns arrive wrapped as {"result": value}; unwrap so variables stay plain
        if isinstance(structured, dict) and set(structured) == {"result"}:
            return structured["result"]
        return structured
    texts = []
    for item in getattr(result, "content", []) or []:
        text = getattr(item, "text", None)
        if text is not None:
            texts.append(text)
        else:
            texts.append(json.dumps(item.model_dump(), default=str))
    if len(texts) == 1:
        try:
            return json.loads(texts[0])
        except (json.JSONDecodeError, TypeError):
            return texts[0]
    return "\n".join(texts)


class _Worker:
    def __init__(self, cfg: ServerConfig):
        self.cfg = cfg
        self.queue: asyncio.Queue[tuple[str, dict, asyncio.Future] | None] = asyncio.Queue()
        self.tools: list[ToolInfo] = []
        self.ready: asyncio.Future = asyncio.get_event_loop().create_future()
        self.task: asyncio.Task | None = None

    async def run(self) -> None:
        try:
            async with self._transport() as (read, write), ClientSession(read, write) as session:
                if True:  # keep the body's indentation stable
                    await session.initialize()
                    listed = await session.list_tools()
                    self.tools = [
                        ToolInfo(t.name, t.description or "", t.input_schema or {})
                        for t in listed.tools
                    ]
                    if not self.ready.done():
                        self.ready.set_result(True)
                    while True:
                        item = await self.queue.get()
                        if item is None:
                            return
                        name, args, fut = item
                        try:
                            res = await asyncio.wait_for(
                                session.call_tool(name, args), CALL_TIMEOUT
                            )
                            if getattr(res, "is_error", False):
                                raise RuntimeError(f"tool {name} failed: {_result_to_value(res)}")
                            fut.set_result(_result_to_value(res))
                        except Exception as e:  # noqa: BLE001 - report to the caller, keep serving
                            if not fut.done():
                                fut.set_exception(e)
        except Exception as e:  # noqa: BLE001
            if not self.ready.done():
                self.ready.set_exception(e)
            else:
                log.warning("mcp server %s stopped: %s", self.cfg.name, e)
                # fail anything still queued
                while not self.queue.empty():
                    item = self.queue.get_nowait()
                    if item and not item[2].done():
                        item[2].set_exception(
                            RuntimeError(f"mcp server {self.cfg.name} disconnected")
                        )

    def _transport(self):
        if self.cfg.transport == "stdio":
            if not self.cfg.command:
                raise ValueError("stdio server needs a command")
            env = {**os.environ, **self.cfg.env}
            return stdio_client(
                StdioServerParameters(command=self.cfg.command, args=self.cfg.args, env=env)
            )
        if self.cfg.transport == "http":
            from mcp.client.streamable_http import streamable_http_client

            if not self.cfg.url:
                raise ValueError("http server needs a url")
            return _HttpTransport(self.cfg.url, self.cfg.headers, streamable_http_client)
        raise ValueError(f"unknown transport {self.cfg.transport}")


class _HttpTransport:
    """Adapts streamable_http_client's (read, write, ...) tuple to the (read, write) pair we use."""

    def __init__(self, url: str, headers: dict, factory):
        self._cm = factory(url, headers=headers or None) if headers else factory(url)

    async def __aenter__(self):
        res = await self._cm.__aenter__()
        return res[0], res[1]

    async def __aexit__(self, *exc):
        return await self._cm.__aexit__(*exc)


class MCPManager:
    def __init__(self):
        self.workers: dict[str, _Worker] = {}

    async def connect(self, cfg: ServerConfig) -> list[ToolInfo]:
        """(Re)connect a server, refresh its tools and register them. Raises on failure."""
        await self.disconnect(cfg.name)
        worker = _Worker(cfg)
        worker.task = asyncio.create_task(worker.run(), name=f"mcp:{cfg.name}")
        self.workers[cfg.name] = worker
        try:
            await asyncio.wait_for(worker.ready, CONNECT_TIMEOUT)
        except Exception:
            await self.disconnect(cfg.name)
            raise
        for t in worker.tools:
            self._register(cfg.name, t)
        return worker.tools

    def _register(self, server: str, t: ToolInfo) -> None:
        async def call(**kwargs: Any) -> Any:
            return await self.call(server, t.name, kwargs)

        tool_registry.register_dynamic(
            tool_id(server, t.name), t.description, call, server=server, schema=t.input_schema
        )

    async def call(self, server: str, tool: str, args: dict) -> Any:
        worker = self.workers.get(server)
        if worker is None or worker.task is None or worker.task.done():
            raise RuntimeError(f"mcp server {server!r} is not connected")
        fut: asyncio.Future = asyncio.get_event_loop().create_future()
        await worker.queue.put((tool, args, fut))
        return await fut

    async def disconnect(self, name: str) -> None:
        worker = self.workers.pop(name, None)
        if worker is None:
            return
        tool_registry.unregister_prefix(f"mcp:{name}:")
        if worker.task and not worker.task.done():
            await worker.queue.put(None)
            try:
                await asyncio.wait_for(worker.task, 5)
            except (TimeoutError, asyncio.CancelledError, Exception):  # noqa: BLE001
                worker.task.cancel()

    async def close(self) -> None:
        for name in list(self.workers):
            await self.disconnect(name)

    def status(self, name: str) -> str:
        w = self.workers.get(name)
        if w is None:
            return "disconnected"
        if w.task and w.task.done():
            return "stopped"
        return "connected" if w.ready.done() and not w.ready.exception() else "connecting"


manager = MCPManager()
