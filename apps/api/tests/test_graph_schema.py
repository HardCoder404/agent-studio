import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.schemas.graph import GraphCreate

EXAMPLES = Path(__file__).resolve().parents[3] / "examples"


def load(name: str) -> dict:
    return json.loads((EXAMPLES / name).read_text())


def minimal(**overrides) -> dict:
    g = {
        "name": "t",
        "nodes": [
            {"id": "s", "type": "start"},
            {"id": "a", "type": "llm"},
            {"id": "e", "type": "end"},
        ],
        "edges": [
            {"id": "e1", "source": "s", "target": "a"},
            {"id": "e2", "source": "a", "target": "e"},
        ],
    }
    g.update(overrides)
    return g


def test_example_validates():
    spec = GraphCreate.model_validate(load("tweet-review.json")).to_spec()
    assert spec.version == 1
    assert {n.type for n in spec.nodes} == {"start", "llm", "human", "router", "end"}


def test_minimal_ok():
    GraphCreate.model_validate(minimal())


@pytest.mark.parametrize(
    "patch, message",
    [
        (
            {"nodes": [{"id": "a", "type": "llm"}, {"id": "e", "type": "end"}], "edges": []},
            "exactly one start",
        ),
        ({"edges": [{"id": "e1", "source": "s", "target": "zzz"}]}, "unknown target"),
        (
            {
                "edges": [
                    {"id": "e1", "source": "s", "target": "a"},
                    {"id": "e1", "source": "a", "target": "e"},
                ]
            },
            "edge ids must be unique",
        ),
        (
            {"nodes": [{"id": "s", "type": "start"}, {"id": "s", "type": "end"}]},
            "node ids must be unique",
        ),
        (
            {
                "nodes": [
                    {"id": "s", "type": "start"},
                    {"id": "a", "type": "banana"},
                    {"id": "e", "type": "end"},
                ]
            },
            "banana",
        ),
    ],
)
def test_structural_errors(patch, message):
    with pytest.raises(ValidationError) as exc:
        GraphCreate.model_validate(minimal(**patch))
    assert message in str(exc.value)


def test_router_edges_must_match_branches():
    g = minimal(
        nodes=[
            {"id": "s", "type": "start"},
            {
                "id": "r",
                "type": "router",
                "config": {
                    "mode": "rule",
                    "branches": [{"label": "yes", "when": "x"}, {"label": "no", "when": "y"}],
                },
            },
            {"id": "e", "type": "end"},
        ],
        edges=[
            {"id": "e1", "source": "s", "target": "r"},
            {"id": "e2", "source": "r", "target": "e", "label": "yes"},
        ],
    )
    with pytest.raises(ValidationError) as exc:
        GraphCreate.model_validate(g)
    assert "must match branches" in str(exc.value)


def test_unknown_field_rejected():
    with pytest.raises(ValidationError):
        GraphCreate.model_validate(minimal(extra_field=1))
