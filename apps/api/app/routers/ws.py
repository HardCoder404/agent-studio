"""Live run events over WebSocket.

    ws://host/ws/runs/{run_id}?after=<seq>

On connect: current status, then persisted events with seq > after (replay), then live
events until the run reaches a terminal state. Reconnect with the last seq you saw.
"""

import asyncio
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from app.db.session import SessionLocal
from app.db.tables import Run, RunEvent
from app.engine import bus
from app.engine.executor import TERMINAL

router = APIRouter(tags=["runs"])


@router.websocket("/ws/runs/{run_id}")
async def run_events_ws(ws: WebSocket, run_id: uuid.UUID, after: int = 0) -> None:
    await ws.accept()
    try:
        # Subscribe first so nothing emitted during replay is lost; dedupe by seq below.
        async with bus.subscribe(run_id) as queue:
            async with SessionLocal() as db:
                run = await db.get(Run, run_id)
                if run is None:
                    await ws.send_json({"type": "error", "error": "run not found"})
                    await ws.close(code=4404)
                    return
                status = run.status
                rows = (
                    await db.execute(
                        select(RunEvent)
                        .where(RunEvent.run_id == run_id, RunEvent.seq > after)
                        .order_by(RunEvent.seq)
                    )
                ).scalars()
                last_seq = after
                await ws.send_json(
                    {"seq": None, "type": "status", "status": status, "replay": True}
                )
                for e in rows:
                    last_seq = e.seq
                    await ws.send_json(
                        {
                            "seq": e.seq,
                            "type": e.type,
                            "node": e.node_id,
                            "ts": e.ts.isoformat(),
                            **e.payload,
                        }
                    )

            if status in TERMINAL:
                await ws.close(code=1000)
                return

            while True:
                event = await queue.get()
                if event.get("seq") is not None and event["seq"] <= last_seq:
                    continue  # already sent during replay
                if event.get("seq") is not None:
                    last_seq = event["seq"]
                await ws.send_json(event)
                if event.get("type") == "status" and event.get("status") in TERMINAL:
                    await ws.close(code=1000)
                    return
    except (WebSocketDisconnect, asyncio.CancelledError):
        return
