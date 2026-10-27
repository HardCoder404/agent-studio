from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.engine import checkpointer
from app.engine.mcp import manager as mcp_manager
from app.routers import evals, graphs, mcp, models, runs, stats, tools, ws
from app.settings import settings


@asynccontextmanager
async def lifespan(_: FastAPI):
    await checkpointer.open_postgres(settings.database_url)
    await mcp.connect_all_enabled()
    yield
    await mcp_manager.close()
    await checkpointer.close()


app = FastAPI(title="Agent Studio API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(graphs.router)
app.include_router(models.router)
app.include_router(runs.router)
app.include_router(tools.router)
app.include_router(ws.router)
app.include_router(evals.datasets)
app.include_router(evals.evals)
app.include_router(stats.router)
app.include_router(mcp.router)


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "groq": bool(settings.groq_api_key),
        "gemini": bool(settings.gemini_api_key),
        "langfuse": bool(settings.langfuse_public_key and settings.langfuse_secret_key),
    }
