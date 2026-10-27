import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.session import Base, get_session
from app.main import app


@pytest.fixture
async def client(monkeypatch, tmp_path):
    # Each test gets a throwaway in-memory SQLite database; no Postgres needed to run tests.
    # A throwaway file database per test: separate connections (unlike :memory:), no shared-cursor
    # conflicts when the runner commits while the test polls, and it still needs no Postgres.
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path}/test.db")
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
