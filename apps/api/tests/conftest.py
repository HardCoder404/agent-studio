import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.db.session import Base, get_session
from app.main import app


@pytest.fixture
async def client(monkeypatch):
    # Each test gets a throwaway in-memory SQLite database; no Postgres needed to run tests.
    # StaticPool: one shared connection, so concurrent sessions see the same in-memory database
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)

    async def _session():
        async with sessions() as s:
            yield s

    app.dependency_overrides[get_session] = _session
    monkeypatch.setattr("app.engine.executor.SessionLocal", sessions)
    monkeypatch.setattr("app.evals.runner.SessionLocal", sessions)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()
    await engine.dispose()
