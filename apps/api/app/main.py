from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import graphs, models
from app.settings import settings

app = FastAPI(title="Agent Studio API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(graphs.router)
app.include_router(models.router)


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "groq": bool(settings.groq_api_key),
        "gemini": bool(settings.gemini_api_key),
    }
