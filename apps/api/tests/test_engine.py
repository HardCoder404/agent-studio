import json
from pathlib import Path

import pytest
from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import Command

from app.engine.compiler import compile_graph
from app.engine.executor import run_config
from app.engine.rules import evaluate
from app.engine.template import render, render_value
from app.schemas.graph import GraphCreate
from tests.fakes import script

EXAMPLE = json.loads(
    (Path(__file__).resolve().parents[3] / "examples" / "tweet-review.json").read_text()
)


def spec_of(data: dict):
    return GraphCreate.model_validate(data).to_spec()


# ---- template + rules -----------------------------------------------------------------


def test_render():
    assert render("hi {{name}}, {{ missing }}!", {"name": "Prince"}) == "hi Prince, !"
    assert render("{{a.b}}", {"a": {"b": 3}}) == "3"
    assert render_value({"url": "{{u}}", "n": 2, "l": ["{{u}}"]}, {"u": "x"}) == {
        "url": "x",
        "n": 2,
        "l": ["x"],
    }


@pytest.mark.parametrize(
    "expr, vars, expected",
    [
        ("decision == 'yes'", {"decision": "yes"}, True),
        ("decision != 'yes'", {"decision": "no"}, True),
        ("len(draft) < 10", {"draft": "short"}, True),
        ("score >= 7 and lower(tone) == 'calm'", {"score": 8, "tone": "Calm"}, True),
        ("__import__('os')", {}, False),
        ("unknown_var == 1", {}, False),
    ],
)
def test_rules(expr, vars, expected):
    assert evaluate(expr, vars) is expected


# ---- compile + run --------------------------------------------------------------------


async def test_example_runs_with_interrupt_and_loop(monkeypatch):
    script(monkeypatch, ["first draft", "punchier draft"])
    graph = compile_graph(spec_of(EXAMPLE), MemorySaver())
    cfg = run_config("t1")

    out = await graph.ainvoke({"vars": {"topic": "agents"}, "trace": []}, cfg)
    assert out["vars"]["draft"] == "first draft"
    assert out["__interrupt__"][0].value["question"].startswith("Approve")
    assert out["__interrupt__"][0].value["show"] == {"draft": "first draft"}

    out = await graph.ainvoke(Command(resume="no"), cfg)  # router -> rewrite -> review again
    assert out["vars"]["draft"] == "punchier draft"
    assert "__interrupt__" in out

    out = await graph.ainvoke(Command(resume="yes"), cfg)  # router -> end
    assert "__interrupt__" not in out
    assert out["vars"]["decision"] == "yes"

    models = [t["model"] for t in out["trace"] if "model" in t]
    assert models == ["groq/openai/gpt-oss-20b", "groq/openai/gpt-oss-120b"]
    assert all(t["input_tokens"] == 10 for t in out["trace"] if "model" in t)

    history = [s async for s in graph.aget_state_history(cfg)]
    assert len(history) > 5  # one checkpoint per step: this is what time-travel reads


async def test_tool_and_code_nodes():
    data = {
        "name": "tools",
        "nodes": [
            {"id": "s", "type": "start"},
            {
                "id": "t",
                "type": "tool",
                "config": {"tool": "echo", "args": {"text": "hi {{who}}"}, "output_key": "echoed"},
            },
            {
                "id": "c",
                "type": "code",
                "config": {
                    "source": "def main(state):\n    return {'shout': state['echoed'].upper()}\n"
                },
            },
            {"id": "e", "type": "end"},
        ],
        "edges": [
            {"id": "1", "source": "s", "target": "t"},
            {"id": "2", "source": "t", "target": "c"},
            {"id": "3", "source": "c", "target": "e"},
        ],
    }
    graph = compile_graph(spec_of(data))
    out = await graph.ainvoke({"vars": {"who": "prince"}, "trace": []})
    assert out["vars"] == {"who": "prince", "echoed": "hi prince", "shout": "HI PRINCE"}


def test_unknown_tool_fails_at_compile():
    data = {
        "name": "bad",
        "nodes": [
            {"id": "s", "type": "start"},
            {"id": "t", "type": "tool", "config": {"tool": "nope"}},
            {"id": "e", "type": "end"},
        ],
        "edges": [
            {"id": "1", "source": "s", "target": "t"},
            {"id": "2", "source": "t", "target": "e"},
        ],
    }
    with pytest.raises(ValueError, match="unknown tool"):
        compile_graph(spec_of(data))


async def test_llm_router(monkeypatch):
    script(monkeypatch, ["Refund."])  # router answer with trailing punctuation is tolerated
    data = {
        "name": "triage",
        "nodes": [
            {"id": "s", "type": "start"},
            {
                "id": "r",
                "type": "router",
                "config": {
                    "mode": "llm",
                    "input_key": "ticket",
                    "branches": [
                        {"label": "refund", "when": "customer wants money back"},
                        {"label": "bug", "when": "something is broken"},
                    ],
                },
            },
            {
                "id": "a",
                "type": "code",
                "config": {"source": "def main(s):\n    return {'team': 'finance'}\n"},
            },
            {
                "id": "b",
                "type": "code",
                "config": {"source": "def main(s):\n    return {'team': 'eng'}\n"},
            },
            {"id": "e", "type": "end"},
        ],
        "edges": [
            {"id": "1", "source": "s", "target": "r"},
            {"id": "2", "source": "r", "target": "a", "label": "refund"},
            {"id": "3", "source": "r", "target": "b", "label": "bug"},
            {"id": "4", "source": "a", "target": "e"},
            {"id": "5", "source": "b", "target": "e"},
        ],
    }
    out = await compile_graph(spec_of(data)).ainvoke(
        {"vars": {"ticket": "I want my money back"}, "trace": []}
    )
    assert out["vars"]["team"] == "finance"
