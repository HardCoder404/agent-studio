import httpx
import pytest

from app.engine import tools


@pytest.mark.anyio
async def test_http_get_tolerates_pasted_whitespace_and_missing_scheme(monkeypatch):
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(200, text="hello world")

    real_client = httpx.AsyncClient

    def patched(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return real_client(*args, **kwargs)

    monkeypatch.setattr(tools.httpx, "AsyncClient", patched)

    assert await tools.http_get("  https://example.com/a  ", max_chars=5) == "hello"
    assert await tools.http_get("example.com/b") == "hello world"
    assert seen == ["https://example.com/a", "https://example.com/b"]
