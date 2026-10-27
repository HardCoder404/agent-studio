# Agent Studio

Visual builder and debugger for multi-agent workflows. Compose agents on a canvas,
run them with live streaming, then step back through any run: inspect state at each
checkpoint, edit it, fork from that point, and compare runs side by side.

## Layout

```
apps/web        Next.js app (canvas, inspector, timeline)
apps/api        FastAPI + LangGraph runtime
packages/schema Graph JSON schema shared by both
examples/       Example workflows
evals/          Datasets and scorers
```

## Run locally

```bash
docker compose up -d                 # Postgres on :5433
cd apps/api && uv sync && uv run uvicorn app.main:app --reload   # :8000
cd apps/web && npm install && npm run dev                        # :3000
```

Copy `.env.example` to `.env` and fill in keys.
