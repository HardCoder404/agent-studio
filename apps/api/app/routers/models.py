import time

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.llm.catalog import CATALOG
from app.llm.provider import ainvoke_with_retry, get_chat_model
from app.llm.usage import usage_from_message
from app.settings import settings

router = APIRouter(prefix="/models", tags=["models"])


@router.get("")
def list_models() -> list[dict]:
    configured = {"groq": bool(settings.groq_api_key), "gemini": bool(settings.gemini_api_key)}
    return [
        {
            "id": m.id,
            "provider": m.provider,
            "tier": m.tier,
            "context": m.context,
            "input_per_m": m.input_per_m,
            "output_per_m": m.output_per_m,
            "available": configured[m.provider],
        }
        for m in CATALOG.values()
    ]


class PingBody(BaseModel):
    prompt: str = "Reply with the single word: pong"


@router.post("/{model_id:path}/ping")
async def ping_model(model_id: str, body: PingBody) -> dict:
    if model_id not in CATALOG:
        raise HTTPException(404, f"unknown model {model_id}")
    llm = get_chat_model(model_id, temperature=0, max_tokens=128)
    t0 = time.perf_counter()
    try:
        msg = await ainvoke_with_retry(llm, body.prompt)
    except Exception as e:  # surface provider errors as 502, not 500
        raise HTTPException(502, f"{type(e).__name__}: {e}") from e
    return {
        "model": model_id,
        "text": msg.content,
        "latency_ms": round((time.perf_counter() - t0) * 1000),
        **usage_from_message(model_id, msg).as_dict(),
    }
