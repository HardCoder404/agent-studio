"""The state object that flows through every compiled graph."""

import operator
from typing import Annotated, TypedDict


def merge_vars(left: dict, right: dict) -> dict:
    """Reducer: node outputs are shallow-merged into the shared variables."""
    return {**left, **right}


class TraceEntry(TypedDict, total=False):
    node: str
    model: str
    input_tokens: int
    output_tokens: int
    cost_usd: float
    latency_ms: int


class RunState(TypedDict):
    vars: Annotated[dict, merge_vars]
    trace: Annotated[list[TraceEntry], operator.add]
