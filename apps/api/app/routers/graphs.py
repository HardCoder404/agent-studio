from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.db.tables import Graph
from app.schemas.graph import GraphCreate, GraphSpec, Issue

router = APIRouter(prefix="/graphs", tags=["graphs"])

Db = Annotated[AsyncSession, Depends(get_session)]


class GraphOut(GraphSpec):
    issues: list[Issue] = Field(default_factory=list)


def _out(spec: GraphSpec) -> GraphOut:
    return GraphOut(**spec.model_dump(), issues=spec.lint_issues())


@router.post("", response_model=GraphOut, status_code=status.HTTP_201_CREATED)
async def create_graph(body: GraphCreate, db: Db) -> GraphOut:
    spec = body.to_spec()
    row = Graph(id=spec.id, name=spec.name, version=1, spec=spec.model_dump(mode="json"))
    db.add(row)
    await db.commit()
    return _out(spec)


@router.get("", response_model=list[dict])
async def list_graphs(db: Db) -> list[dict]:
    rows = (await db.execute(select(Graph).order_by(Graph.updated_at.desc()))).scalars().all()
    return [
        {
            "id": str(r.id),
            "name": r.name,
            "version": r.version,
            "nodes": len(r.spec.get("nodes", [])),
            "issues": len(GraphSpec.model_validate(r.spec).lint_issues()),
            "updated_at": r.updated_at,
        }
        for r in rows
    ]


async def _get(db: AsyncSession, graph_id: UUID) -> Graph:
    row = await db.get(Graph, graph_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "graph not found")
    return row


@router.get("/{graph_id}", response_model=GraphOut)
async def get_graph(graph_id: UUID, db: Db) -> GraphOut:
    return _out(GraphSpec.model_validate((await _get(db, graph_id)).spec))


@router.put("/{graph_id}", response_model=GraphOut)
async def update_graph(graph_id: UUID, body: GraphCreate, db: Db) -> GraphOut:
    row = await _get(db, graph_id)
    row.version += 1
    spec = body.to_spec(graph_id)
    spec.version = row.version
    row.name = spec.name
    row.spec = spec.model_dump(mode="json")
    await db.commit()
    return _out(spec)


@router.delete("/{graph_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_graph(graph_id: UUID, db: Db) -> None:
    await db.delete(await _get(db, graph_id))
    await db.commit()
