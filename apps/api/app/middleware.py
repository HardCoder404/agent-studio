"""Small guards for a public demo: CORS from settings, a per-IP rate limit on mutating
requests, and a daily budget of model calls so a free tier cannot be drained."""

from __future__ import annotations

import time
from collections import defaultdict, deque
from datetime import UTC, datetime

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.settings import settings

_hits: dict[str, deque[float]] = defaultdict(deque)


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    return (fwd.split(",")[0].strip() if fwd else None) or (
        request.client.host if request.client else "?"
    )


def install(app: FastAPI) -> None:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def rate_limit(request: Request, call_next):
        if request.method in ("POST", "PUT", "DELETE") and settings.rate_limit_per_minute > 0:
            now = time.monotonic()
            q = _hits[_client_ip(request)]
            while q and now - q[0] > 60:
                q.popleft()
            if len(q) >= settings.rate_limit_per_minute:
                return JSONResponse(
                    {"detail": "too many requests, slow down"},
                    status_code=429,
                    headers={"Retry-After": "60"},
                )
            q.append(now)
        return await call_next(request)


class Budget:
    """Daily cap on model calls across the whole process. Resets at UTC midnight."""

    def __init__(self):
        self.day = datetime.now(UTC).date()
        self.used = 0

    def check_and_count(self) -> None:
        today = datetime.now(UTC).date()
        if today != self.day:
            self.day, self.used = today, 0
        limit = settings.daily_llm_call_budget
        if limit and self.used >= limit:
            raise BudgetExceeded(f"daily model-call budget of {limit} reached; try again tomorrow")
        self.used += 1

    def snapshot(self) -> dict:
        return {
            "used": self.used,
            "limit": settings.daily_llm_call_budget or None,
            "day": str(self.day),
        }


class BudgetExceeded(RuntimeError):
    pass


budget = Budget()
