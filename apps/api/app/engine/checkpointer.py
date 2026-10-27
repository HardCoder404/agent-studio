"""Process-wide checkpointer. Postgres in the app, in-memory in tests."""

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.memory import MemorySaver

_saver: BaseCheckpointSaver | None = None
_pool = None


async def open_postgres(database_url: str) -> BaseCheckpointSaver:
    global _saver, _pool
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
    from psycopg.rows import dict_row
    from psycopg_pool import AsyncConnectionPool

    _pool = AsyncConnectionPool(
        conninfo=database_url,
        max_size=10,
        open=False,
        kwargs={"autocommit": True, "prepare_threshold": 0, "row_factory": dict_row},
    )
    await _pool.open()
    saver = AsyncPostgresSaver(_pool)
    await saver.setup()  # creates checkpoint tables if missing (idempotent)
    _saver = saver
    return saver


async def close() -> None:
    global _saver, _pool
    if _pool is not None:
        await _pool.close()
    _saver, _pool = None, None


def use_memory() -> BaseCheckpointSaver:
    global _saver
    _saver = MemorySaver()
    return _saver


def get_checkpointer() -> BaseCheckpointSaver:
    if _saver is None:
        raise RuntimeError("checkpointer not initialised; call open_postgres() or use_memory()")
    return _saver
