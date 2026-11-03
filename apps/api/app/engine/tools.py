"""Built-in tools a `tool` node can call. MCP-imported tools register here later too."""

from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

import httpx

ToolFn = Callable[..., Awaitable[Any]]
_REGISTRY: dict[str, dict] = {}  # name -> {fn, description, server, schema}


def register(name: str, description: str) -> Callable[[ToolFn], ToolFn]:
    def deco(fn: ToolFn) -> ToolFn:
        _REGISTRY[name] = {"fn": fn, "description": description, "server": None, "schema": None}
        return fn

    return deco


def register_dynamic(
    name: str, description: str, fn: ToolFn, *, server: str | None, schema: dict | None
) -> None:
    """Used by MCP: tools that appear and disappear at runtime."""
    _REGISTRY[name] = {"fn": fn, "description": description, "server": server, "schema": schema}


def unregister_prefix(prefix: str) -> None:
    for name in [n for n in _REGISTRY if n.startswith(prefix)]:
        del _REGISTRY[name]


def get_tool(name: str) -> ToolFn:
    try:
        return _REGISTRY[name]["fn"]
    except KeyError as e:
        raise ValueError(f"unknown tool {name!r}; known: {sorted(_REGISTRY)}") from e


def list_tools() -> list[dict]:
    return [
        {"name": n, "description": t["description"], "server": t["server"], "schema": t["schema"]}
        for n, t in sorted(_REGISTRY.items())
    ]


@register("current_time", "Current UTC time as ISO-8601")
async def current_time() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


@register("http_get", "GET a URL and return the first `max_chars` characters of the body")
async def http_get(url: str, max_chars: int = 4000) -> str:
    url = str(url).strip()
    if not url.lower().startswith(("http://", "https://")):
        url = "https://" + url
    async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
        r = await client.get(url, headers={"User-Agent": "agent-studio/0.1"})
        r.raise_for_status()
        return r.text[: int(max_chars)]


@register(
    "http_post", "POST JSON to a URL and return the first `max_chars` characters of the response"
)
async def http_post(
    url: str,
    body: dict | list | str | None = None,
    headers: dict | None = None,
    max_chars: int = 4000,
) -> str:
    url = str(url).strip()
    if not url.lower().startswith(("http://", "https://")):
        url = "https://" + url
    hdrs = {"User-Agent": "agent-studio/0.1", **(headers or {})}
    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
        if isinstance(body, str):
            r = await client.post(url, content=body, headers=hdrs)
        else:
            r = await client.post(url, json=body if body is not None else {}, headers=hdrs)
        r.raise_for_status()
        return r.text[: int(max_chars)]


@register(
    "telegram_send",
    "Send `text` to your Telegram chat (needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID)",
)
async def telegram_send(text: str, chat_id: str = "") -> str:
    from app.integrations import telegram
    from app.settings import settings

    target = str(chat_id or settings.telegram_chat_id)
    if not (settings.telegram_bot_token and target):
        raise RuntimeError(
            "telegram is not configured: set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID"
        )
    res = await telegram.call("sendMessage", chat_id=target, text=str(text)[:4000])
    if not res or not res.get("ok"):
        raise RuntimeError(f"telegram send failed: {(res or {}).get('description', 'no response')}")
    return f"sent to {target}"


@register("echo", "Return its `text` argument unchanged (handy for testing)")
async def echo(text: str = "") -> str:
    return text
