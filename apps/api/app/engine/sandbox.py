"""Runs a code node's Python in a throwaway Docker container.

The container has no network, a memory cap, a pid cap and a hard timeout. The source and
the state go in on stdin as JSON; the result comes back on stdout as JSON. If Docker is not
available the code runs in a plain subprocess of the API's interpreter (development only).
"""

from __future__ import annotations

import asyncio
import json
import shutil
import uuid
from functools import lru_cache
from typing import Literal

from app.settings import settings

Mode = Literal["docker", "inprocess"]
IMAGE = "python:3.12-slim"

# Executed inside the container: everything it needs arrives on stdin.
_RUNNER = r"""
import json, sys, traceback
payload = json.load(sys.stdin)
ns = {"__name__": "__node__"}
try:
    exec(compile(payload["source"], "<code node>", "exec"), ns)
    main = ns.get("main")
    if not callable(main):
        raise TypeError("define `def main(state): ...`")
    result = main(payload["state"])
    if not isinstance(result, dict):
        raise TypeError("main() must return a dict of variables")
    print(json.dumps({"ok": True, "result": result}, default=str))
except Exception as e:  # report, never crash the runner
    print(json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}", "trace": traceback.format_exc()[-1500:]}))
"""


class SandboxError(RuntimeError):
    pass


@lru_cache(maxsize=1)
def _docker_available() -> bool:
    return shutil.which("docker") is not None


def mode() -> Mode:
    pref = settings.code_sandbox
    if pref == "docker":
        return "docker"
    if pref == "inprocess":
        return "inprocess"
    return "docker" if _docker_available() else "inprocess"


async def run(source: str, state: dict, timeout_s: int = 10) -> dict:
    """Execute `main(state)` from `source` and return the dict it produced."""
    if mode() == "docker":
        return await _run_docker(source, state, timeout_s)
    return await _run_inprocess(source, state, timeout_s)


async def _run_docker(source: str, state: dict, timeout_s: int) -> dict:
    name = f"studio-code-{uuid.uuid4().hex[:12]}"
    args = [
        "docker", "run", "--rm", "-i", "--name", name,
        "--network", "none",
        "--memory", settings.code_sandbox_memory,
        "--cpus", "0.5",
        "--pids-limit", "64",
        "--read-only", "--tmpfs", "/tmp:size=16m",
        "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
        "--user", "65534:65534",
        IMAGE, "python", "-c", _RUNNER,
    ]  # fmt: skip
    return await _run_cmd(
        args, source, state, timeout_s + 2, container=name
    )  # +2s: container start-up


async def _run_inprocess(source: str, state: dict, timeout_s: int) -> dict:
    """Development fallback: a plain subprocess of this interpreter. It can be killed on
    timeout (a thread cannot), but it is NOT isolated: use Docker anywhere untrusted."""
    import sys

    return await _run_cmd([sys.executable, "-I", "-c", _RUNNER], source, state, timeout_s)


async def _run_cmd(
    args: list[str], source: str, state: dict, timeout_s: float, container: str | None = None
) -> dict:
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    payload = json.dumps({"source": source, "state": state}, default=str).encode()
    try:
        out, err = await asyncio.wait_for(proc.communicate(payload), timeout=timeout_s)
    except TimeoutError:
        proc.kill()
        await proc.wait()
        if container:  # killing the docker client does not stop the container; stop it explicitly
            killer = await asyncio.create_subprocess_exec(
                "docker",
                "rm",
                "-f",
                container,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            await killer.wait()
        raise SandboxError(f"code node timed out after {timeout_s:g}s") from None
    if proc.returncode != 0 and not out.strip():
        msg = err.decode(errors="replace").strip()
        if "Cannot connect to the Docker daemon" in msg or "docker: command not found" in msg:
            raise SandboxError("Docker is not running; start it or set CODE_SANDBOX=inprocess")
        if proc.returncode == 137:
            raise SandboxError(
                f"code node exceeded the memory limit ({settings.code_sandbox_memory})"
            )
        raise SandboxError(f"sandbox failed (exit {proc.returncode}): {msg[-400:]}")
    return _parse(out)


def _parse(out: bytes) -> dict:
    line = out.decode(errors="replace").strip().splitlines()[-1] if out.strip() else ""
    try:
        data = json.loads(line)
    except json.JSONDecodeError:
        raise SandboxError(f"sandbox returned no result: {out[-300:]!r}") from None
    if not data.get("ok"):
        raise SandboxError(data.get("error", "code node failed"))
    return data["result"]
