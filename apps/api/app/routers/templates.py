"""Example workflows shipped in /examples, duplication, and read-only share links."""

import json
import secrets
import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.db.tables import Graph
from app.schemas.graph import GraphCreate, GraphSpec


def _find_examples() -> Path:
    """The examples folder lives at the repo root; in the Docker image it is copied to /examples."""
    here = Path(__file__).resolve()
    for parent in [*here.parents, Path("/")]:
        candidate = parent / "examples"
        if candidate.is_dir() and any(candidate.glob("*.json")):
            return candidate
    return here.parents[0] / "examples"  # empty but harmless


EXAMPLES = _find_examples()

router = APIRouter(tags=["templates"])
Db = Annotated[AsyncSession, Depends(get_session)]


def _templates() -> dict[str, dict]:
    return {f.stem: json.loads(f.read_text()) for f in sorted(EXAMPLES.glob("*.json"))}


def _out(spec: GraphSpec, **extra) -> dict:
    return {
        **spec.model_dump(mode="json"),
        "issues": [i.model_dump() for i in spec.lint_issues()],
        **extra,
    }


@router.get("/templates")
def list_templates() -> list[dict]:
    return [
        {
            "id": slug,
            "name": t["name"],
            "description": t.get("description", ""),
            "nodes": len(t["nodes"]),
            "node_types": sorted({n["type"] for n in t["nodes"]}),
        }
        for slug, t in _templates().items()
    ]


@router.post("/graphs/from-template/{slug}", status_code=status.HTTP_201_CREATED)
async def create_from_template(slug: str, db: Db) -> dict:
    t = _templates().get(slug)
    if t is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "template not found")
    spec = GraphCreate.model_validate(
        {k: v for k, v in t.items() if k in ("name", "description", "nodes", "edges")}
    ).to_spec()
    db.add(Graph(id=spec.id, name=spec.name, version=1, spec=spec.model_dump(mode="json")))
    await db.commit()
    return _out(spec)


@router.post("/graphs/{graph_id}/duplicate", status_code=status.HTTP_201_CREATED)
async def duplicate_graph(graph_id: uuid.UUID, db: Db) -> dict:
    src = await db.get(Graph, graph_id)
    if src is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "graph not found")
    spec = GraphSpec.model_validate(src.spec)
    copy = GraphSpec(
        id=uuid.uuid4(), name=f"{spec.name} (copy)", nodes=spec.nodes, edges=spec.edges
    )
    db.add(Graph(id=copy.id, name=copy.name, version=1, spec=copy.model_dump(mode="json")))
    await db.commit()
    return _out(copy)


@router.post("/graphs/{graph_id}/share")
async def share_graph(graph_id: uuid.UUID, db: Db) -> dict:
    """Mint (or return) a read-only share token for the graph."""
    g = await db.get(Graph, graph_id)
    if g is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "graph not found")
    if not g.share_token:
        g.share_token = secrets.token_urlsafe(24)
        await db.commit()
    return {"token": g.share_token}


@router.delete("/graphs/{graph_id}/share", status_code=status.HTTP_204_NO_CONTENT)
async def unshare_graph(graph_id: uuid.UUID, db: Db) -> None:
    g = await db.get(Graph, graph_id)
    if g is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "graph not found")
    g.share_token = None
    await db.commit()


async def _by_token(db: AsyncSession, token: str) -> Graph:
    g = await db.scalar(select(Graph).where(Graph.share_token == token))
    if g is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no graph for this link")
    return g


@router.get("/share/{token}")
async def get_shared(token: str, db: Db) -> dict:
    """Read-only view of a shared graph: the spec, nothing else."""
    return _out(GraphSpec.model_validate((await _by_token(db, token)).spec), shared=True)


@router.post("/share/{token}/fork", status_code=status.HTTP_201_CREATED)
async def fork_shared(token: str, db: Db) -> dict:
    """Copy a shared graph into the viewer's own graphs."""
    return await duplicate_graph((await _by_token(db, token)).id, db)
