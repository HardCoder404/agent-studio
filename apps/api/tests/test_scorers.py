import pytest

from app.evals.scorers import ScorerSpec, score, score_rule


def test_exact_and_contains():
    assert score_rule(ScorerSpec(kind="exact"), "Yes.", "yes.").passed
    assert not score_rule(ScorerSpec(kind="exact", case_sensitive=True), "Yes", "yes").passed
    s = score_rule(ScorerSpec(kind="contains"), "the quick brown fox", ["quick", "fox", "cat"])
    assert s.score == pytest.approx(2 / 3) and not s.passed and "cat" in s.detail


def test_regex_json_length():
    assert score_rule(ScorerSpec(kind="regex", pattern=r"^#\w+"), "#AI rocks", None).passed
    j = score_rule(ScorerSpec(kind="json_valid", required_keys=["a", "b"]), '{"a": 1}', None)
    assert j.score == 0.5 and "b" in j.detail
    assert not score_rule(ScorerSpec(kind="json_valid"), "{nope", None).passed
    assert score_rule(ScorerSpec(kind="max_length", max_chars=5), "abc", None).passed
    assert not score_rule(ScorerSpec(kind="max_length", max_chars=2), "abc", None).passed


async def test_llm_judge_parses_reply(monkeypatch):
    from tests.fakes import ScriptedChat

    chat = ScriptedChat(responses=['Sure! {"score": 0.9, "reason": "clear and short"}'])
    monkeypatch.setattr("app.evals.scorers.get_chat_model", lambda *a, **k: chat)
    s = await score(
        ScorerSpec(kind="llm_judge", key="draft", pass_threshold=0.7),
        {"draft": "x"},
        {"input": {"topic": "t"}},
    )
    assert s.passed and s.score == 0.9 and s.detail == "clear and short"
    assert s.usage and s.usage.input_tokens == 10


async def test_llm_judge_garbage(monkeypatch):
    from tests.fakes import ScriptedChat

    monkeypatch.setattr(
        "app.evals.scorers.get_chat_model", lambda *a, **k: ScriptedChat(responses=["no json here"])
    )
    s = await score(ScorerSpec(kind="llm_judge"), {"output": "x"}, {})
    assert not s.passed and "not parseable" in s.detail
