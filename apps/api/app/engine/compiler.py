"""GraphSpec (what the canvas saves) -> compiled LangGraph (what actually runs)."""

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph

from app.engine import runners
from app.engine.state import RunState
from app.schemas.graph import GraphSpec


async def _passthrough(state: RunState) -> dict:
    return {}


def compile_graph(
    spec: GraphSpec, checkpointer: BaseCheckpointSaver | None = None
) -> CompiledStateGraph:
    g = StateGraph(RunState)
    deciders = {}

    for node in spec.nodes:
        match node.type:
            case "start" | "end":
                g.add_node(node.id, _passthrough)
            case "llm":
                g.add_node(node.id, runners.make_llm_runner(node))
            case "tool":
                g.add_node(node.id, runners.make_tool_runner(node))
            case "human":
                g.add_node(node.id, runners.make_human_runner(node))
            case "code":
                g.add_node(node.id, runners.make_code_runner(node))
            case "router":
                run, decide = runners.make_router(node)
                g.add_node(node.id, run)
                deciders[node.id] = decide

    start = next(n for n in spec.nodes if n.type == "start")
    g.add_edge(START, start.id)
    for node in spec.nodes:
        if node.type == "end":
            g.add_edge(node.id, END)

    for node in spec.nodes:
        out = [e for e in spec.edges if e.source == node.id]
        if node.id in deciders:
            g.add_conditional_edges(node.id, deciders[node.id], {e.label: e.target for e in out})
        else:
            for e in out:
                g.add_edge(e.source, e.target)

    return g.compile(checkpointer=checkpointer)
