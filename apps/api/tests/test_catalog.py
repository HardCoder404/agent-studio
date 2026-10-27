import pytest

from app.llm.catalog import estimate_cost_usd, get_model_info


def test_cost_estimate():
    # gpt-oss-20b: $0.075 in / $0.30 out per 1M
    assert estimate_cost_usd("groq/openai/gpt-oss-20b", 1_000_000, 1_000_000) == pytest.approx(
        0.375
    )


def test_unknown_model():
    with pytest.raises(ValueError, match="unknown model"):
        get_model_info("nope/x")
