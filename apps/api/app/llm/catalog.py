"""Model catalog. Ids are "<provider>/<model>" so the UI can show one flat list.

Prices are list prices in USD per 1M tokens, used only to estimate cost per run.
Free tiers bill nothing, but the estimate still tells you what a run *would* cost.
"""

from dataclasses import dataclass
from typing import Literal

Provider = Literal["groq", "gemini"]


@dataclass(frozen=True)
class ModelInfo:
    id: str
    provider: Provider
    name: str  # provider-side model name
    tier: Literal["small", "medium", "large"]
    input_per_m: float
    output_per_m: float
    context: int


CATALOG: dict[str, ModelInfo] = {
    m.id: m
    for m in [
        ModelInfo(
            "groq/openai/gpt-oss-20b", "groq", "openai/gpt-oss-20b", "small", 0.075, 0.30, 131072
        ),
        ModelInfo(
            "groq/qwen/qwen3.8-27b", "groq", "qwen/qwen3.8-27b", "medium", 0.29, 0.59, 131072
        ),
        ModelInfo(
            "groq/openai/gpt-oss-120b", "groq", "openai/gpt-oss-120b", "large", 0.15, 0.60, 131072
        ),
        ModelInfo(
            "gemini/gemini-2.5-flash", "gemini", "gemini-2.5-flash", "medium", 0.30, 2.50, 1048576
        ),
    ]
}


def get_model_info(model_id: str) -> ModelInfo:
    try:
        return CATALOG[model_id]
    except KeyError as e:
        raise ValueError(f"unknown model {model_id!r}; known: {sorted(CATALOG)}") from e


def estimate_cost_usd(model_id: str, input_tokens: int, output_tokens: int) -> float:
    m = get_model_info(model_id)
    return (input_tokens * m.input_per_m + output_tokens * m.output_per_m) / 1_000_000
