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

    # Exponential backoff: 1s, 2s, 4s between attempts, 4 attempts total.
    return llm.with_retry(
        retry_if_exception_type=_RETRYABLE or (Exception,),
        wait_exponential_jitter=True,
        stop_after_attempt=4,
    )
