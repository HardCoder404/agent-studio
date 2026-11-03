"""Telegram approvals: a run paused at a human node is sent to a chat with answer buttons, and
the button press resumes it. Everything here is best-effort and never breaks a run."""

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


def enabled() -> bool:
    return bool(settings.telegram_bot_token and settings.telegram_chat_id)


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


def build_message(run_id: uuid.UUID, graph_id: uuid.UUID, graph_name: str, intr: dict) -> dict:
    question = str(intr.get("question") or "Approve?")
    show = intr.get("show") or {}
    lines = [f"<b>{_esc(graph_name)}</b> is waiting for you", "", _esc(question)]
    for k, v in list(show.items())[:4]:
        lines += ["", f"<i>{_esc(str(k))}</i>", _esc(_fmt(v))]
    answers = quick_answers(question)
    keyboard = [[{"text": a.capitalize(), "callback_data": f"r:{run_id}:{a}"} for a in answers]]
    if web_url():
        keyboard.append(
            [{"text": "Open in Studio", "url": f"{web_url()}/graphs/{graph_id}?run={run_id}"}]
        )
    return {
        "chat_id": settings.telegram_chat_id,
        "text": "\n".join(lines)[:4000],
        "parse_mode": "HTML",
        "reply_markup": {"inline_keyboard": keyboard},
    }


def notify_paused(run_id: uuid.UUID, graph_id: uuid.UUID, graph_name: str, intr: dict) -> None:
    """Fire-and-forget from the executor: never awaited on the run's critical path."""
    if not enabled():
        return
    asyncio.create_task(call("sendMessage", **build_message(run_id, graph_id, graph_name, intr)))


def parse_callback(data: str) -> tuple[uuid.UUID, str] | None:
    try:
        tag, rid, answer = data.split(":", 2)
        if tag != "r":
            return None
        return uuid.UUID(rid), answer
    except Exception:  # noqa: BLE001
        return None


async def ensure_webhook() -> None:
    """Point the bot at this API (idempotent). Needs the token, the secret and a public URL."""
    if not (settings.telegram_bot_token and settings.webhook_secret and settings.public_api_url):
        return
    url = f"{settings.public_api_url.rstrip('/')}/hooks/telegram/{sign('telegram')}"
    await call("setWebhook", url=url, allowed_updates=["message", "callback_query"])
