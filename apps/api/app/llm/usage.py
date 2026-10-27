"""Pull token usage out of a LangChain response and turn it into a cost estimate."""

from dataclasses import dataclass

from langchain_core.messages import AIMessage

from app.llm.catalog import estimate_cost_usd


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0

    def __add__(self, other: "Usage") -> "Usage":
        return Usage(
            self.input_tokens + other.input_tokens,
            self.output_tokens + other.output_tokens,
            self.cost_usd + other.cost_usd,
        )

    def as_dict(self) -> dict:
        return {
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "cost_usd": round(self.cost_usd, 6),
        }


def usage_from_message(model_id: str, msg: AIMessage) -> Usage:
    meta = msg.usage_metadata or {}
    i, o = int(meta.get("input_tokens", 0)), int(meta.get("output_tokens", 0))
    return Usage(i, o, estimate_cost_usd(model_id, i, o))
