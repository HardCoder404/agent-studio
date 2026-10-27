import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import SessionLocal, get_session
from app.db.tables import MCPServer
from app.engine.mcp import ServerConfig, manager

router = APIRouter(prefix="/mcp/servers", tags=["mcp"])
Db = Annotated[AsyncSession, Depends(get_session)]


class ServerBody(BaseModel):
    name: str = Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    transport: str = Field(pattern=r"^(stdio|http)$")
    command: str | None = None
    args: list[str] = Field(default_factory=list)
    env: dict[str, str] = Field(default_factory=dict)
    url: str | None = None
    headers: dict[str, str] = Field(default_factory=dict)


def _cfg(row: MCPServer) -> ServerConfig:
    return ServerConfig(
        row.name,
        row.transport,
        row.command,
        list(row.args or []),
        dict(row.env or {}),
        row.url,
        dict(row.headers or {}),
    )


def _view(row: MCPServer) -> dict:
    return {
        "id": str(row.id),
        "name": row.name,
        "transport": row.transport,
        "command": row.command,
        "args": row.args,
        "env": {k: "•••" for k in (row.env or {})},  # never echo secrets back
        "url": row.url,
        "headers": {k: "•••" for k in (row.headers or {})},
        "enabled": row.enabled,
        "tools": row.tools,
        "status": manager.status(row.name),
        "last_error": row.last_error,
        "updated_at": row.updated_at,
    }


async def _connect(row: MCPServer, db: AsyncSession) -> None:
    try:
        tools = await manager.connect(_cfg(row))
        row.tools = [
            {"name": t.name, "description": t.description, "input_schema": t.input_schema}
            for t in tools
        ]
        row.last_error = None
    except Exception as e:  # noqa: BLE001
        row.last_error = f"{type(e).__name__}: {e}"[:500]
    await db.commit()
    await db.refresh(row)


async def connect_all_enabled() -> None:
    """Called at API startup so saved servers come back with their tools."""
    async with SessionLocal() as db:
        rows = (
            (await db.execute(select(MCPServer).where(MCPServer.enabled.is_(True)))).scalars().all()
        )
        for row in rows:
            await _connect(row, db)


@router.get("")
async def list_servers(db: Db) -> list[dict]:
    rows = (await db.execute(select(MCPServer).order_by(MCPServer.name))).scalars().all()
    return [_view(r) for r in rows]


@router.post("", status_code=status.HTTP_201_CREATED)
async def add_server(body: ServerBody, db: Db) -> dict:
    if await db.scalar(select(MCPServer).where(MCPServer.name == body.name)):
        raise HTTPException(status.HTTP_409_CONFLICT, f"server {body.name!r} already exists")
    if body.transport == "stdio" and not body.command:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "stdio servers need a command")
    if body.transport == "http" and not body.url:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "http servers need a url")
    row = MCPServer(**body.model_dump())
    db.add(row)
    await db.commit()
    await db.refresh(row)
    await _connect(row, db)
    return _view(row)


@router.post("/{server_id}/refresh")
async def refresh_server(server_id: uuid.UUID, db: Db) -> dict:
    row = await db.get(MCPServer, server_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "server not found")
    await _connect(row, db)
    return _view(row)


@router.delete("/{server_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_server(server_id: uuid.UUID, db: Db) -> None:
    row = await db.get(MCPServer, server_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "server not found")
    await manager.disconnect(row.name)
    await db.delete(row)
    await db.commit()
