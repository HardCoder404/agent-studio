"""Scorers turn (expected, actual) into a score in [0, 1] plus a pass flag.

Rule scorers are deterministic. The LLM judge asks a model to grade against a rubric and
is the only scorer that costs tokens.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Literal

from langchain_core.messages import HumanMessage
from pydantic import BaseModel, Field

from app.llm.provider import get_chat_model
from app.llm.usage import Usage, usage_from_message

ScorerKind = Literal["exact", "contains", "regex", "json_valid", "max_length", "llm_judge"]


class ScorerSpec(BaseModel):
    """One scorer as configured in the UI."""

    kind: ScorerKind
    key: str = "output"  # which output variable to grade
    expected_field: str = "expected"  # dataset row field holding the reference, if any
    case_sensitive: bool = False
    pattern: str | None = None  # regex
    max_chars: int = 280  # max_length
    required_keys: list[str] = Field(default_factory=list)  # json_valid
    rubric: str = "Grade how well the answer satisfies the task. Be strict."  # llm_judge
    model: str = "groq/openai/gpt-oss-120b"
    pass_threshold: float = 0.7

    @property
    def name(self) -> str:
        return f"{self.kind}:{self.key}"


@dataclass
class Score:
    score: float
    passed: bool
    detail: str = ""
    usage: Usage | None = None

    def as_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "score": round(self.score, 4),
            "passed": self.passed,
            "detail": self.detail,
        }
        if self.usage:
            d["usage"] = self.usage.as_dict()
        return d


def _text(v: Any) -> str:
    return v if isinstance(v, str) else json.dumps(v, ensure_ascii=False)


def _norm(s: str, case_sensitive: bool) -> str:
    s = s.strip()
    return s if case_sensitive else s.lower()


def score_rule(spec: ScorerSpec, actual: Any, expected: Any) -> Score:
    text = _text(actual) if actual is not None else ""
    match spec.kind:
        case "exact":
            ok = _norm(text, spec.case_sensitive) == _norm(_text(expected), spec.case_sensitive)
            return Score(1.0 if ok else 0.0, ok, "" if ok else f"expected {_text(expected)!r}")
        case "contains":
            needles = expected if isinstance(expected, list) else [expected]
            hay = _norm(text, spec.case_sensitive)
            missing = [n for n in needles if _norm(_text(n), spec.case_sensitive) not in hay]
            frac = 1 - len(missing) / max(len(needles), 1)
            return Score(frac, not missing, "" if not missing else f"missing {missing}")
        case "regex":
            ok = bool(
                re.search(spec.pattern or "", text, 0 if spec.case_sensitive else re.IGNORECASE)
            )
            return Score(1.0 if ok else 0.0, ok, "" if ok else f"no match for /{spec.pattern}/")
        case "json_valid":
            try:
                parsed = json.loads(text) if isinstance(actual, str) else actual
            except json.JSONDecodeError as e:
                return Score(0.0, False, f"invalid JSON: {e.msg}")
            if not isinstance(parsed, dict):
                return Score(
                    0.0 if spec.required_keys else 1.0, not spec.required_keys, "not an object"
                )
            missing = [k for k in spec.required_keys if k not in parsed]
            return Score(
                1 - len(missing) / max(len(spec.required_keys), 1),
                not missing,
                "" if not missing else f"missing keys {missing}",
            )
        case "max_length":
            limit = spec.max_chars
            ok = len(text) <= limit
            return Score(
                1.0 if ok else max(0.0, limit / max(len(text), 1)),
                ok,
                "" if ok else f"{len(text)} chars > {limit}",
            )
    raise ValueError(f"{spec.kind} is not a rule scorer")


_JUDGE_PROMPT = """You are grading the output of an AI workflow.

Rubric: {rubric}

Task input:
{inp}

{expected_block}Answer to grade:
{actual}

Reply with ONLY a JSON object: {{"score": <number from 0 to 1>, "reason": "<one sentence>"}}"""


async def score_llm_judge(spec: ScorerSpec, actual: Any, expected: Any, row_input: dict) -> Score:
    llm = get_chat_model(spec.model, temperature=0, max_tokens=200)
    expected_block = (
        f"Reference answer (may be partial):\n{_text(expected)}\n\n"
        if expected not in (None, "")
        else ""
    )
    prompt = _JUDGE_PROMPT.format(
        rubric=spec.rubric,
        inp=json.dumps(row_input, ensure_ascii=False),
        expected_block=expected_block,
        actual=_text(actual),
    )
    msg = await llm.ainvoke([HumanMessage(prompt)])
    raw = msg.content if isinstance(msg.content, str) else ""
    usage = usage_from_message(spec.model, msg)
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    if not m:
        return Score(0.0, False, f"judge reply not parseable: {raw[:80]}", usage)
    try:
        data = json.loads(m.group(0))
        score = float(data.get("score", 0))
        reason = str(data.get("reason", ""))
    except (ValueError, TypeError, json.JSONDecodeError):
        return Score(0.0, False, f"judge reply not parseable: {raw[:80]}", usage)
    score = min(1.0, max(0.0, score))
    return Score(score, score >= spec.pass_threshold, reason, usage)


async def score(spec: ScorerSpec, output: dict, row: dict) -> Score:
    actual = output.get(spec.key)
    expected = row.get(spec.expected_field)
    if spec.kind == "llm_judge":
        return await score_llm_judge(spec, actual, expected, row.get("input", {}))
    return score_rule(spec, actual, expected)
