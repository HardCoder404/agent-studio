"""Tiny {{variable}} templating for prompts and tool args. No logic, on purpose."""

import re
from typing import Any

_VAR = re.compile(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}")


def _lookup(vars: dict, path: str) -> Any:
    cur: Any = vars
    for part in path.split("."):
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        else:
            raise KeyError(path)
    return cur


def render(template: str, vars: dict) -> str:
    def sub(m: re.Match) -> str:
        try:
            value = _lookup(vars, m.group(1))
        except KeyError:
            return ""  # missing variables render empty rather than crashing a run
        return value if isinstance(value, str) else str(value)

    return _VAR.sub(sub, template)


def render_value(value: Any, vars: dict) -> Any:
    """Render strings inside nested dicts/lists (tool args)."""
    if isinstance(value, str):
        return render(value, vars)
    if isinstance(value, dict):
        return {k: render_value(v, vars) for k, v in value.items()}
    if isinstance(value, list):
        return [render_value(v, vars) for v in value]
    return value
