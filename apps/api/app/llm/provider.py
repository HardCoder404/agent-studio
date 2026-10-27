"""One entry point for chat models: get_chat_model("groq/openai/gpt-oss-20b").

Wraps provider SDKs (via LangChain) with retry on rate limits so graph nodes never
have to know which vendor they are talking to.
"""

from functools import lru_cache

from langchain_core.language_models import BaseChatModel

from app.llm.catalog import get_model_info
from app.settings import settings

_RETRYABLE: tuple[type[Exception], ...]
try:
    from groq import APIConnectionError as _GroqConn
    from groq import APIStatusError as _GroqStatus
    from groq import RateLimitError as _GroqRate

    _RETRYABLE = (_GroqRate, _GroqConn, _GroqStatus)
except ImportError:  # pragma: no cover
    _RETRYABLE = ()


@lru_cache(maxsize=32)
def get_chat_model(
    model_id: str, temperature: float = 0.2, max_tokens: int = 1024
) -> BaseChatModel:
    info = get_model_info(model_id)

    if info.provider == "groq":
        if not settings.groq_api_key:
            raise RuntimeError("GROQ_API_KEY is not set")
        from langchain_groq import ChatGroq

        # gpt-oss / qwen are reasoning models: keep the hidden reasoning short so that
        # small max_tokens budgets still leave room for the actual answer.
        llm: BaseChatModel = ChatGroq(
            model=info.name,
            api_key=settings.groq_api_key,
            temperature=temperature,
            max_tokens=max_tokens,
            max_retries=0,  # we retry below, with backoff
            reasoning_effort="low",
            reasoning_format="hidden",
        )
    elif info.provider == "gemini":
        if not settings.gemini_api_key:
            raise RuntimeError("GEMINI_API_KEY is not set")
        from langchain_google_genai import ChatGoogleGenerativeAI

        llm = ChatGoogleGenerativeAI(
            model=info.name,
            google_api_key=settings.gemini_api_key,
            temperature=temperature,
            max_output_tokens=max_tokens,
            max_retries=0,
        )
    else:  # pragma: no cover
        raise ValueError(f"unsupported provider {info.provider}")

    return llm


RETRYABLE: tuple[type[Exception], ...] = _RETRYABLE or (Exception,)


async def ainvoke_with_retry(llm: BaseChatModel, messages, on_retry=None, attempts: int = 4):
    """Call the model, retrying rate limits and connection errors with exponential backoff.

    `on_retry(attempt, wait_seconds, reason)` is called before each wait so the UI can show
    "retrying…" instead of a silent stall.
    """
    import asyncio
    import random

    from app.middleware import budget

    for attempt in range(1, attempts + 1):
        budget.check_and_count()
        try:
            return await llm.ainvoke(messages)
        except RETRYABLE as e:
            if attempt == attempts:
                raise
            wait = min(8.0, 2 ** (attempt - 1)) + random.uniform(0, 0.5)
            retry_after = getattr(getattr(e, "response", None), "headers", {}) or {}
            if retry_after.get("retry-after"):
                try:
                    wait = max(wait, float(retry_after["retry-after"]))
                except ValueError:
                    pass
            if on_retry:
                on_retry(attempt, round(wait, 2), f"{type(e).__name__}: {str(e)[:120]}")
            await asyncio.sleep(wait)
    raise RuntimeError("unreachable")
