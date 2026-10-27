from fastapi import APIRouter

from app.engine.tools import list_tools

router = APIRouter(prefix="/tools", tags=["tools"])


@router.get("")
def get_tools() -> list[dict]:
    return list_tools()
