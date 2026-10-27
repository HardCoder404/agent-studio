from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.engine import checkpointer
from app.routers import graphs, models, runs, tools
from app.settings import settings


@asynccontextmanager
async def lifespan(_: FastAPI):
    await checkpointer.open_postgres(settings.database_url)
    yield
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


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "groq": bool(settings.groq_api_key),
        "gemini": bool(settings.gemini_api_key),
    }
