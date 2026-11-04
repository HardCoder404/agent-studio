"""Triggers: start a run from the outside (webhook) and answer a human gate from Telegram."""

from __future__ import annotations

import hmac
import json
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.db.tables import Graph, Run
from app.integrations import telegram
from app.routers.runs import resume_paused, start_run
from app.settings import settings

router = APIRouter(tags=["triggers"])
Db = Annotated[AsyncSession, Depends(get_session)]


def _check(scope: str, token: str) -> None:
    if not settings.webhook_secret:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "webhooks are disabled (set WEBHOOK_SECRET)")
    if not hmac.compare_digest(telegram.sign(scope), token):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "unknown hook")


def _public_base(request: Request) -> str:
    if settings.public_api_url:
        return settings.public_api_url.rstrip("/")
    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    return f"{proto}://{request.url.netloc}"


def _telegram_view(graph: Graph) -> dict:
    if not telegram.enabled():
        return {
            "bot": False,
            "linked": False,
            "connect_url": None,
            "hint": "No Telegram bot on this API yet (set TELEGRAM_BOT_TOKEN and WEBHOOK_SECRET).",
        }
    if graph.telegram_chat_id:
        return {
            "bot": True,
            "linked": True,
            "connect_url": None,
            "hint": "Runs that pause at a Human step are sent to your chat with answer buttons.",
        }
    return {
        "bot": True,
        "linked": False,
        "connect_url": telegram.connect_url(graph.id),
        "start_command": f"/start {telegram.link_param(graph.id)}",
        "hint": "Connect your Telegram: the bot opens, press Start, and this graph's approvals come to you.",
    }


@router.get("/graphs/{graph_id}/triggers")
async def graph_triggers(graph_id: uuid.UUID, request: Request, db: Db) -> dict:
    """What can start or continue this graph without the UI. Shown in the editor's Triggers tab."""
    graph = await db.get(Graph, graph_id)
    if graph is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "graph not found")
    enabled = bool(settings.webhook_secret)
    return {
        "webhook": {
            "enabled": enabled,
            "url": (
                f"{_public_base(request)}/hooks/{graph_id}/{telegram.sign(str(graph_id))}"
                if enabled
                else None
            ),
            "method": "POST",
            "hint": "Send a JSON object; its keys become the run input.",
        },
        "telegram": _telegram_view(graph),
    }


@router.delete("/graphs/{graph_id}/telegram", status_code=status.HTTP_204_NO_CONTENT)
async def unlink_telegram(graph_id: uuid.UUID, db: Db) -> None:
    graph = await db.get(Graph, graph_id)
    if graph is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "graph not found")
    graph.telegram_chat_id = None
    await db.commit()


# Declared before the graph hook: "/hooks/telegram/..." must not be parsed as a graph id.
@router.post("/hooks/telegram/{token}")
async def telegram_update(token: str, update: dict, db: Db) -> dict:
    """Telegram posts every message and button press here. Always answer 200 so it stops retrying."""
    _check("telegram", token)
    cq = update.get("callback_query")
    if cq:
        await _handle_button(db, cq)
        return {"ok": True}
    msg = update.get("message") or {}
    text = str(msg.get("text", "")).strip()
    chat_id = (msg.get("chat") or {}).get("id")
    if text.startswith("/start") and chat_id is not None:
        param = text.split(maxsplit=1)[1] if " " in text else ""
        graph_id = telegram.parse_link(param)
        graph = await db.get(Graph, graph_id) if graph_id else None
        if graph is None:
            await telegram.call(
                "sendMessage",
                chat_id=chat_id,
                text="Hi! Open a graph in Agent Studio, go to the Triggers tab and press "
                "Connect Telegram. Its approvals will then show up here.",
            )
        else:
            graph.telegram_chat_id = str(chat_id)
            await db.commit()
            await telegram.call(
                "sendMessage",
                chat_id=chat_id,
                text=f"Connected to “{graph.name}”. When a run pauses for you, it will show up "
                "here with answer buttons.",
            )
    return {"ok": True}


async def _handle_button(db: AsyncSession, cq: dict) -> None:
    async def answer(text: str) -> None:
        await telegram.call("answerCallbackQuery", callback_query_id=cq.get("id"), text=text)

    parsed = telegram.parse_callback(str(cq.get("data", "")))
    if parsed is None:
        await answer("Unknown button.")
        return
    run_id, value = parsed
    msg = cq.get("message") or {}
    chat = str((msg.get("chat") or {}).get("id", ""))
    run = await db.get(Run, run_id)
    graph = await db.get(Graph, run.graph_id) if run else None
    if run is None or graph is None:
        await answer("Run not found.")
        return
    if not graph.telegram_chat_id or chat != graph.telegram_chat_id:
        await answer("This chat is not connected to that graph.")
        return
    if run.status != "paused":
        await answer("This run is not waiting any more.")
        return
    await resume_paused(db, run, value)
    await answer(f"Resumed with “{value}”")
    if msg.get("message_id"):
        await telegram.call(
            "editMessageText",
            chat_id=msg["chat"]["id"],
            message_id=msg["message_id"],
            text=(msg.get("text") or "") + f"\n\n✅ answered: {value}",
        )


@router.post("/hooks/{graph_id}/{token}", status_code=status.HTTP_202_ACCEPTED)
async def webhook_start(graph_id: uuid.UUID, token: str, request: Request, db: Db) -> dict:
    _check(str(graph_id), token)
    graph = await db.get(Graph, graph_id)
    if graph is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "graph not found")
    raw = await request.body()
    body: Any = {}
    if raw.strip():
        try:
            body = json.loads(raw)
        except ValueError:
            body = {"payload": raw.decode("utf-8", "replace")}
    inputs = body if isinstance(body, dict) else {"payload": body}
    run = await start_run(db, graph, inputs)
    return {"id": str(run.id), "status": run.status}
