import pytest

from app import middleware
from app.middleware import BudgetExceeded


async def test_rate_limit(client, monkeypatch):
    monkeypatch.setattr(middleware.settings, "rate_limit_per_minute", 3)
    middleware._hits.clear()
    codes = [
        (await client.post("/graphs", json={"name": "x", "nodes": [], "edges": []})).status_code
        for _ in range(5)
    ]
    assert codes[:3] == [201, 201, 201] and codes[3:] == [429, 429]
    assert (await client.get("/graphs")).status_code == 200  # reads are never limited
    middleware._hits.clear()


def test_budget(monkeypatch):
    b = middleware.Budget()
    monkeypatch.setattr(middleware.settings, "daily_llm_call_budget", 2)
    b.check_and_count()
    b.check_and_count()
    with pytest.raises(BudgetExceeded, match="budget of 2"):
        b.check_and_count()
    assert b.snapshot()["used"] == 2
    monkeypatch.setattr(middleware.settings, "daily_llm_call_budget", 0)
    b.check_and_count()  # unlimited
