"""Triggers: start a run from the outside (webhook) and answer a human gate from Telegram."""

from __future__ import annotations

import hmac
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


@router.get("/graphs/{graph_id}/triggers")
async def graph_triggers(graph_id: uuid.UUID, request: Request, db: Db) -> dict:
    """What can start or continue this graph without the UI. Shown in the editor's Triggers tab."""
    if await db.get(Graph, graph_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "graph not found")
    enabled = bool(settings.webhook_secret)
    return {
        "webhook": {
            "enabled": enabled,
            "url": f"{_public_base(request)}/hooks/{graph_id}/{telegram.sign(str(graph_id))}"
            if enabled
            else None,
            "method": "POST",
            "hint": "Send a JSON object; its keys become the run input.",
        },
        "telegram": {
            "enabled": telegram.enabled(),
            "hint": "Paused runs are sent to your chat with answer buttons."
            if telegram.enabled()
            else "Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID on the API to get paused runs on your phone.",
        },
    }


# Declared before the graph hook: "/hooks/telegram/..." must not be parsed as a graph id.
@router.post("/hooks/telegram/{token}")
async def telegram_update(token: str, update: dict, db: Db) -> dict:
    """Telegram posts every button press here. Always answer 200 so Telegram stops retrying."""
    _check("telegram", token)
    cq = update.get("callback_query")
    if cq:
        parsed = telegram.parse_callback(str(cq.get("data", "")))
        chat = str(((cq.get("message") or {}).get("chat") or {}).get("id", ""))
        if settings.telegram_chat_id and chat != str(settings.telegram_chat_id):
            await telegram.call(
                "answerCallbackQuery", callback_query_id=cq["id"], text="Not your studio."
            )
            return {"ok": True}
        if parsed is None:
            await telegram.call(
                "answerCallbackQuery", callback_query_id=cq["id"], text="Unknown button."
            )
            return {"ok": True}
        run_id, answer = parsed
        run = await db.get(Run, run_id)
        if run is None or run.status != "paused":
            note = "This run is not waiting any more." if run else "Run not found."
            await telegram.call("answerCallbackQuery", callback_query_id=cq["id"], text=note)
        else:
            await resume_paused(db, run, answer)
            await telegram.call(
                "answerCallbackQuery", callback_query_id=cq["id"], text=f"Resumed with “{answer}”"
            )
            msg = cq.get("message") or {}
            if msg.get("message_id"):
                await telegram.call(
                    "editMessageText",
                    chat_id=msg["chat"]["id"],
                    message_id=msg["message_id"],
                    text=(msg.get("text") or "") + f"\n\n✅ answered: {answer}",
                )
        return {"ok": True}
    msg = update.get("message") or {}
    if str(msg.get("text", "")).strip().startswith("/start"):
        chat_id = (msg.get("chat") or {}).get("id")
        await telegram.call(
            "sendMessage",
            chat_id=chat_id,
            text=f"Hi! This chat id is {chat_id}. Put it in TELEGRAM_CHAT_ID on the API and paused runs will show up here.",
        )
    return {"ok": True}


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
            import json

            body = json.loads(raw)
        except ValueError:
            body = {"payload": raw.decode("utf-8", "replace")}
    inputs = body if isinstance(body, dict) else {"payload": body}
    run = await start_run(db, graph, inputs)
    return {"id": str(run.id), "status": run.status}
