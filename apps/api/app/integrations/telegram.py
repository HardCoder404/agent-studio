"""Telegram approvals. One bot serves the deployment; every graph binds its own chat through the
bot's /start link, so a paused run goes only to the person who connected that graph. Everything
here is best-effort and never breaks a run."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import re
import uuid
from typing import Any

import httpx

from app.settings import settings

log = logging.getLogger(__name__)
API = "https://api.telegram.org/bot{token}/{method}"
_username: str | None = None  # bot username, learned from getMe on boot


def enabled() -> bool:
    """A bot is configured for this deployment (chats are bound per graph)."""
    return bool(settings.telegram_bot_token and settings.webhook_secret)


def sign(scope: str) -> str:
    """Path token for inbound hooks: HMAC of the scope (graph id or "telegram") with the secret."""
    return hmac.new(settings.webhook_secret.encode(), scope.encode(), hashlib.sha256).hexdigest()[
        :32
    ]


def web_url() -> str:
    return settings.cors_origins.split(",")[0].strip().rstrip("/")


async def call(method: str, **payload: Any) -> dict | None:
    if not settings.telegram_bot_token:
        return None
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                API.format(token=settings.telegram_bot_token, method=method), json=payload
            )
            data = r.json()
            if not data.get("ok"):
                log.warning("telegram %s failed: %s", method, data.get("description"))
            return data
    except Exception as e:  # noqa: BLE001 - notifications must never take a run down
        log.warning("telegram %s error: %s", method, e)
        return None


# ---- linking a graph to a chat ---------------------------------------------------------------


def link_param(graph_id: uuid.UUID) -> str:
    """Payload for t.me/<bot>?start=<param>: graph id plus a signature so it cannot be guessed."""
    return graph_id.hex + sign(f"tg:{graph_id}")[:16]


def parse_link(param: str) -> uuid.UUID | None:
    param = (param or "").strip()
    if len(param) != 48:
        return None
    try:
        graph_id = uuid.UUID(hex=param[:32])
    except ValueError:
        return None
    if not hmac.compare_digest(sign(f"tg:{graph_id}")[:16], param[32:]):
        return None
    return graph_id


def connect_url(graph_id: uuid.UUID) -> str | None:
    if not (enabled() and _username):
        return None
    return f"https://t.me/{_username}?start={link_param(graph_id)}"


async def ensure_bot() -> None:
    """Learn the bot's username and point its webhook at this API (idempotent, best-effort)."""
    global _username
    if not enabled():
        return
    me = await call("getMe")
    if me and me.get("ok"):
        _username = me["result"].get("username")
    if settings.public_api_url:
        url = f"{settings.public_api_url.rstrip('/')}/hooks/telegram/{sign('telegram')}"
        await call("setWebhook", url=url, allowed_updates=["message", "callback_query"])


# ---- messages ------------------------------------------------------------------------------------


def quick_answers(question: str) -> list[str]:
    """'Approve? (yes/no)' -> ['yes', 'no']; anything else -> ['yes', 'no'] as a sane default."""
    m = re.search(r"\(([^()]{1,40})\)", question or "")
    if m and "/" in m.group(1):
        opts = [o.strip() for o in m.group(1).split("/") if o.strip()]
        if 2 <= len(opts) <= 4:
            return opts
    return ["yes", "no"]


def _fmt(v: Any, limit: int = 600) -> str:
    s = v if isinstance(v, str) else json.dumps(v, ensure_ascii=False, default=str)
    return s if len(s) <= limit else s[: limit - 1] + "…"


def _esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def build_message(
    chat_id: str, run_id: uuid.UUID, graph_id: uuid.UUID, graph_name: str, intr: dict
) -> dict:
    question = str(intr.get("question") or "Approve?")
    show = intr.get("show") or {}
    lines = [f"<b>{_esc(graph_name)}</b> is waiting for you", "", _esc(question)]
    for k, v in list(show.items())[:4]:
        lines += ["", f"<i>{_esc(str(k))}</i>", _esc(_fmt(v))]
    answers = quick_answers(question)
    keyboard = [[{"text": a.capitalize(), "callback_data": f"r:{run_id}:{a}"} for a in answers]]
    # Telegram rejects non-https button URLs (e.g. http://localhost in dev), so the link is optional.
    if web_url().startswith("https://"):
        keyboard.append(
            [{"text": "Open in Studio", "url": f"{web_url()}/graphs/{graph_id}?run={run_id}"}]
        )
    return {
        "chat_id": chat_id,
        "text": "\n".join(lines)[:4000],
        "parse_mode": "HTML",
        "reply_markup": {"inline_keyboard": keyboard},
    }


def notify_paused(
    chat_id: str | None, run_id: uuid.UUID, graph_id: uuid.UUID, graph_name: str, intr: dict
) -> None:
    """Fire-and-forget from the executor: never awaited on the run's critical path."""
    if not (enabled() and chat_id):
        return
    asyncio.create_task(
        call("sendMessage", **build_message(chat_id, run_id, graph_id, graph_name, intr))
    )


def parse_callback(data: str) -> tuple[uuid.UUID, str] | None:
    try:
        tag, rid, answer = data.split(":", 2)
        if tag != "r":
            return None
        return uuid.UUID(rid), answer
    except Exception:  # noqa: BLE001
        return None
