from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.settings import settings


class Base(DeclarativeBase):
    pass


def _async_url(url: str) -> str:
    # Accept plain postgresql:// (what tools like psql expect) and upgrade to the async driver.
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


# No pre-ping: it costs a full round trip per checkout, which hurts when the database is in another
# datacenter. Recycling connections every 5 minutes covers pooler-side idle timeouts instead.
engine = create_async_engine(_async_url(settings.database_url), pool_recycle=300)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session
