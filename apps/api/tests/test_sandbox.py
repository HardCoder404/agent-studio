import shutil

import pytest

from app.engine import sandbox
from app.engine.sandbox import SandboxError

docker = pytest.mark.skipif(shutil.which("docker") is None, reason="docker not installed")


async def test_inprocess_roundtrip(monkeypatch):
    monkeypatch.setattr(sandbox.settings, "code_sandbox", "inprocess")
    out = await sandbox.run(
        "def main(state):\n    return {'n': len(state['xs']), 'ok': True}\n", {"xs": [1, 2, 3]}, 5
    )
    assert out == {"n": 3, "ok": True}


async def test_inprocess_errors(monkeypatch):
    monkeypatch.setattr(sandbox.settings, "code_sandbox", "inprocess")
    with pytest.raises(SandboxError, match="define"):
        await sandbox.run("x = 1\n", {}, 5)
    with pytest.raises(SandboxError, match="dict"):
        await sandbox.run("def main(s):\n    return 5\n", {}, 5)
    with pytest.raises(SandboxError, match="timed out"):
        await sandbox.run("def main(s):\n    while True:\n        pass\n", {}, 1)


@docker
async def test_docker_roundtrip_and_isolation(monkeypatch):
    monkeypatch.setattr(sandbox.settings, "code_sandbox", "docker")
    out = await sandbox.run(
        "import json, math\ndef main(state):\n    return {'root': math.sqrt(state['n']), 'who': __import__('getpass').getuser() if False else 'nobody'}\n",
        {"n": 16},
        20,
    )
    assert out["root"] == 4.0
    # no network inside the box
    with pytest.raises(SandboxError, match="urlopen|Network|unreachable|Errno|Name"):
        await sandbox.run(
            "import urllib.request\ndef main(s):\n    return {'b': urllib.request.urlopen('http://example.com', timeout=3).read()[:1].decode()}\n",
            {},
            20,
        )
    # read-only filesystem
    with pytest.raises(SandboxError, match="Read-only|Permission|Errno"):
        await sandbox.run(
            "def main(s):\n    open('/etc/pwned', 'w').write('x')\n    return {}\n", {}, 20
        )


@docker
async def test_docker_timeout(monkeypatch):
    monkeypatch.setattr(sandbox.settings, "code_sandbox", "docker")
    with pytest.raises(SandboxError, match="timed out"):
        await sandbox.run("def main(s):\n    while True:\n        pass\n", {}, 2)
