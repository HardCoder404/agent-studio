"""A tiny MCP server over stdio, used by the tests (and handy as a demo)."""

from mcp.server.mcpserver import MCPServer

server = MCPServer("demo")


@server.tool()
def add(a: int, b: int) -> int:
    """Add two integers."""
    return a + b


@server.tool()
def shout(text: str) -> str:
    """Upper-case the text and add an exclamation mark."""
    return text.upper() + "!"


if __name__ == "__main__":
    server.run(transport="stdio")
