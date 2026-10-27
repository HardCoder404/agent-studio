"""Graph specification: the JSON a user builds on the canvas.

Mirrors packages/schema/graph.schema.json. Structural rules that JSON Schema cannot
express (exactly one start node, every edge points at a real node, ...) live here.
"""

from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, model_validator

NodeType = Literal["start", "end", "llm", "tool", "router", "human", "code"]


class Position(BaseModel):
    x: float = 0
    y: float = 0


# ---- per-node config -----------------------------------------------------------------


class LLMConfig(BaseModel):
    model: str = "groq/openai/gpt-oss-20b"
    system_prompt: str = ""
    prompt: str = "{{input}}"
    temperature: float = Field(default=0.2, ge=0, le=2)
    max_tokens: int = Field(default=1024, ge=1, le=32000)
    output_key: str = "output"


class ToolConfig(BaseModel):
    tool: str  # registered tool name (built-in or MCP)
    args: dict = Field(default_factory=dict)  # may contain {{vars}}
    output_key: str = "tool_result"


class RouterBranch(BaseModel):
    label: str
    when: str  # natural-language condition (llm mode) or expression (rule mode)


class RouterConfig(BaseModel):
    mode: Literal["llm", "rule"] = "llm"
    model: str = "groq/openai/gpt-oss-20b"
    input_key: str = "output"
    branches: list[RouterBranch] = Field(min_length=1)


class HumanConfig(BaseModel):
    question: str = "Approve?"
    show_keys: list[str] = Field(default_factory=list)
    output_key: str = "human_input"


class CodeConfig(BaseModel):
    language: Literal["python"] = "python"
    source: str = "def main(state):\n    return {}\n"
    timeout_s: int = Field(default=10, ge=1, le=60)


# ---- nodes -----------------------------------------------------------------------------


class BaseNode(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=64)
    label: str = ""
    position: Position = Field(default_factory=Position)


class StartNode(BaseNode):
    type: Literal["start"]
    config: dict = Field(default_factory=dict)


class EndNode(BaseNode):
    type: Literal["end"]
    config: dict = Field(default_factory=dict)


class LLMNode(BaseNode):
    type: Literal["llm"]
    config: LLMConfig = Field(default_factory=LLMConfig)


class ToolNode(BaseNode):
    type: Literal["tool"]
    config: ToolConfig


class RouterNode(BaseNode):
    type: Literal["router"]
    config: RouterConfig


class HumanNode(BaseNode):
    type: Literal["human"]
    config: HumanConfig = Field(default_factory=HumanConfig)


class CodeNode(BaseNode):
    type: Literal["code"]
    config: CodeConfig = Field(default_factory=CodeConfig)


Node = Annotated[
    StartNode | EndNode | LLMNode | ToolNode | RouterNode | HumanNode | CodeNode,
    Field(discriminator="type"),
]


class Edge(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=64)
    source: str
    target: str
    label: str | None = None  # router branch label when source is a router


# ---- graph -----------------------------------------------------------------------------


def validate_structure(nodes: list, edges: list[Edge]) -> None:
    """Rules JSON Schema cannot express. Shared by GraphSpec and GraphCreate."""
    ids = [n.id for n in nodes]
    if len(ids) != len(set(ids)):
        raise ValueError("node ids must be unique")
    by_id = {n.id: n for n in nodes}

    starts = [n for n in nodes if n.type == "start"]
    if len(starts) != 1:
        raise ValueError("graph needs exactly one start node")
    if not any(n.type == "end" for n in nodes):
        raise ValueError("graph needs at least one end node")

    edge_ids = [e.id for e in edges]
    if len(edge_ids) != len(set(edge_ids)):
        raise ValueError("edge ids must be unique")

    for e in edges:
        if e.source not in by_id:
            raise ValueError(f"edge {e.id}: unknown source {e.source}")
        if e.target not in by_id:
            raise ValueError(f"edge {e.id}: unknown target {e.target}")
        if by_id[e.source].type == "end":
            raise ValueError(f"edge {e.id}: end node cannot have outgoing edges")
        if by_id[e.target].type == "start":
            raise ValueError(f"edge {e.id}: start node cannot have incoming edges")

    for n in nodes:
        out = [e for e in edges if e.source == n.id]
        if n.type == "router":
            labels = {b.label for b in n.config.branches}
            got = {e.label for e in out}
            if got != labels:
                raise ValueError(
                    f"router {n.id}: edges {sorted(map(str, got))} must match branches {sorted(labels)}"
                )
        elif n.type != "end" and len(out) != 1:
            raise ValueError(f"node {n.id}: must have exactly one outgoing edge, has {len(out)}")


class GraphSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID = Field(default_factory=uuid4)
    name: str = Field(min_length=1, max_length=120)
    version: int = 1
    nodes: list[Node] = Field(default_factory=list)
    edges: list[Edge] = Field(default_factory=list)

    @model_validator(mode="after")
    def check_structure(self) -> GraphSpec:
        validate_structure(self.nodes, self.edges)
        return self


class GraphCreate(BaseModel):
    """Body for POST /graphs: everything except the server-assigned id."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=120)
    nodes: list[Node] = Field(default_factory=list)
    edges: list[Edge] = Field(default_factory=list)

    @model_validator(mode="after")
    def check_structure(self) -> GraphCreate:
        validate_structure(self.nodes, self.edges)
        return self

    def to_spec(self, graph_id: UUID | None = None) -> GraphSpec:
        return GraphSpec(id=graph_id or uuid4(), name=self.name, nodes=self.nodes, edges=self.edges)
