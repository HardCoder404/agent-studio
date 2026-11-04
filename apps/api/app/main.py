from contextlib import asynccontextmanager

from fastapi import FastAPI

from app import middleware
from app.engine import checkpointer, sandbox
from app.engine.mcp import manager as mcp_manager
from app.integrations import telegram
from app.routers import evals, graphs, hooks, mcp, models, runs, stats, templates, tools, ws
from app.settings import settings


@asynccontextmanager
async def lifespan(_: FastAPI):
    await checkpointer.open_postgres(settings.database_url)
    await mcp.connect_all_enabled()
    await telegram.ensure_bot()
    yield
    await mcp_manager.close()
    await checkpointer.close()


app = FastAPI(title="Agent Studio API", version="0.1.0", lifespan=lifespan)

middleware.install(app)

app.include_router(graphs.router)
app.include_router(models.router)
app.include_router(runs.router)
app.include_router(tools.router)
app.include_router(ws.router)
app.include_router(evals.datasets)
app.include_router(evals.evals)
app.include_router(stats.router)
app.include_router(mcp.router)
app.include_router(templates.router)
app.include_router(hooks.router)


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "groq": bool(settings.groq_api_key),
        "gemini": bool(settings.gemini_api_key),
        "langfuse": bool(settings.langfuse_public_key and settings.langfuse_secret_key),
        "code_sandbox": sandbox.mode(),
        "budget": middleware.budget.snapshot(),
    }
