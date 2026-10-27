"""Built-in tools a `tool` node can call. MCP-imported tools register here later too."""

from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

import httpx

ToolFn = Callable[..., Awaitable[Any]]
_REGISTRY: dict[str, tuple[ToolFn, str]] = {}


def register(name: str, description: str) -> Callable[[ToolFn], ToolFn]:
    def deco(fn: ToolFn) -> ToolFn:
        _REGISTRY[name] = (fn, description)
        return fn

    return deco


def get_tool(name: str) -> ToolFn:
    try:
        return _REGISTRY[name][0]
    except KeyError as e:
        raise ValueError(f"unknown tool {name!r}; known: {sorted(_REGISTRY)}") from e


def list_tools() -> list[dict]:
    return [{"name": n, "description": d} for n, (_, d) in sorted(_REGISTRY.items())]


@register("current_time", "Current UTC time as ISO-8601")
async def current_time() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


@register("http_get", "GET a URL and return the first `max_chars` characters of the body")
async def http_get(url: str, max_chars: int = 4000) -> str:
    async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
        r = await client.get(url, headers={"User-Agent": "agent-studio/0.1"})
        r.raise_for_status()
        return r.text[: int(max_chars)]


@register("echo", "Return its `text` argument unchanged (handy for testing)")
async def echo(text: str = "") -> str:
    return text
