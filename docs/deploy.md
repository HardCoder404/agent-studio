# Deploying the demo (free tiers)

| Piece | Where | Why |
|---|---|---|
| Web (Next.js) | Vercel | zero-config Next hosting, free |
| API (FastAPI + LangGraph) | Render, Docker runtime | WebSockets work on the free tier; sleeps after 15 min idle |
| Postgres | Supabase | free 500 MB, pgvector available for later |
| Tracing | Langfuse Cloud (optional) | free Hobby tier |

## 1. Postgres (Supabase)
Create a project → Settings → Database → connection string (URI, **session pooler**, port 5432).
Set it as `DATABASE_URL` on the API. Migrations run on boot (`alembic upgrade head`).

## 2. API (Render)
New → Blueprint → this repo → `render.yaml`. Fill the `sync: false` secrets. After the first deploy,
copy the service URL (e.g. `https://agent-studio-api.onrender.com`).

The free tier has no Docker daemon, so `CODE_SANDBOX=inprocess` runs code nodes in a plain
subprocess. That is fine for a demo with your own graphs; for untrusted users use a host
with Docker (Render Starter + Docker socket, Fly machines, or a VM) and set `CODE_SANDBOX=docker`.

## 3. Web (Vercel)
Import the repo, root directory `apps/web`, env `NEXT_PUBLIC_API_URL=https://<render-url>`.
Then set `CORS_ORIGINS` on Render to the Vercel URL and redeploy the API.

## 4. Keep the API awake (optional)
Repository → Settings → Variables → `DEMO_API_URL=https://<render-url>`. The
`keep-demo-awake` workflow pings `/health` every 10 minutes during the day.

## 5. Triggers and Telegram approvals (optional)
Webhooks need `WEBHOOK_SECRET` (any long random string; the blueprint generates one). Each graph's
Triggers tab then shows its signed URL.

For approvals from a phone: create one bot with @BotFather, set `TELEGRAM_BOT_TOKEN` and
`PUBLIC_API_URL=https://<render-url>` on the API and redeploy (the API registers the Telegram
webhook on boot). Every user then connects their own chat from a graph's Triggers tab
("Connect Telegram" opens the bot with a signed start link). From then on that graph's runs
paused at a human node arrive in that chat with Yes/No buttons, and the button resumes them.

## Local full stack
```bash
cp .env.example .env   # add GROQ_API_KEY
docker compose --profile full up --build
```
Web on :3000, API on :8000, Postgres on :5433.
