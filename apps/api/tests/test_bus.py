import asyncio
import uuid

from app.engine import bus


async def test_publish_subscribe_and_cleanup():
    rid = uuid.uuid4()
    bus.publish(rid, {"type": "lost"})  # no subscribers yet: dropped, no error
    async with bus.subscribe(rid) as q:
        assert bus.subscriber_count(rid) == 1
        bus.publish(rid, {"type": "a"})
        bus.publish(rid, {"type": "b"})
        assert (await q.get())["type"] == "a"
        assert (await q.get())["type"] == "b"
    assert bus.subscriber_count(rid) == 0


async def test_cancel_tracked_task():
    rid = uuid.uuid4()
    assert bus.cancel(rid) is False

    async def forever():
        await asyncio.sleep(60)

    task = asyncio.create_task(forever())
    bus.track(rid, task)
    assert bus.cancel(rid) is True
    try:
        await task
    except asyncio.CancelledError:
        pass
    assert bus.cancel(rid) is False
