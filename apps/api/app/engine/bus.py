"""In-process pub/sub so WebSocket clients see run events the moment the executor emits them.

One process, one bus. If the API ever runs on several workers this becomes Redis pub/sub
with the same two functions.
"""

import asyncio
import uuid
from collections import defaultdict
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

_subscribers: dict[uuid.UUID, set[asyncio.Queue]] = defaultdict(set)
_tasks: dict[uuid.UUID, asyncio.Task] = {}

MAX_QUEUE = 2000  # a slow client drops events rather than stalling the run


def publish(run_id: uuid.UUID, event: dict[str, Any]) -> None:
    for q in list(_subscribers.get(run_id, ())):
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            pass


@asynccontextmanager
async def subscribe(run_id: uuid.UUID) -> AsyncIterator[asyncio.Queue]:
    q: asyncio.Queue = asyncio.Queue(maxsize=MAX_QUEUE)
    _subscribers[run_id].add(q)
    try:
        yield q
    finally:
        _subscribers[run_id].discard(q)
        if not _subscribers[run_id]:
            del _subscribers[run_id]


def subscriber_count(run_id: uuid.UUID) -> int:
    return len(_subscribers.get(run_id, ()))


# ---- running tasks, so a run can be cancelled -----------------------------------------


def track(run_id: uuid.UUID, task: asyncio.Task) -> None:
    _tasks[run_id] = task
    task.add_done_callback(lambda _: _tasks.pop(run_id, None))


def cancel(run_id: uuid.UUID) -> bool:
    task = _tasks.get(run_id)
    if task is None or task.done():
        return False
    task.cancel()
    return True
