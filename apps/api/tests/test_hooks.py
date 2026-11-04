import uuid

import pytest

from app.engine import checkpointer
from app.integrations import telegram
from app.settings import settings
from tests.fakes import script
from tests.test_runs_api import EXAMPLE, wait_for


@pytest.fixture
def triggers(monkeypatch):
    monkeypatch.setattr(settings, "webhook_secret", "test-secret")
    monkeypatch.setattr(settings, "telegram_bot_token", "123:abc")
    monkeypatch.setattr(telegram, "_username", "TestGateBot")
    sent: list[tuple[str, dict]] = []

    async def fake_call(method: str, **payload):
        sent.append((method, payload))
        return {"ok": True, "result": {}}

    monkeypatch.setattr(telegram, "call", fake_call)
    return sent


TG = "/hooks/telegram/"


def tg_path() -> str:
    return TG + telegram.sign("telegram")


async def link(client, gid: str, chat: int) -> None:
    info = (await client.get(f"/graphs/{gid}/triggers")).json()
    param = info["telegram"]["connect_url"].split("start=")[1]
    upd = {"message": {"chat": {"id": chat}, "text": f"/start {param}"}}
    assert (await client.post(tg_path(), json=upd)).status_code == 200


@pytest.mark.anyio
async def test_triggers_disabled_without_secret(client, monkeypatch):
    monkeypatch.setattr(settings, "webhook_secret", "")
    gid = (await client.post("/graphs", json=EXAMPLE)).json()["id"]
    info = (await client.get(f"/graphs/{gid}/triggers")).json()
    assert info["webhook"]["enabled"] is False and info["webhook"]["url"] is None
    assert info["telegram"]["bot"] is False
    assert (await client.post(f"/hooks/{gid}/whatever", json={})).status_code == 404


@pytest.mark.anyio
async def test_webhook_starts_a_run_and_bad_token_is_404(client, monkeypatch, triggers):
    checkpointer.use_memory()
    script(monkeypatch, ["draft one"])
    gid = (await client.post("/graphs", json=EXAMPLE)).json()["id"]
    info = (await client.get(f"/graphs/{gid}/triggers")).json()
    assert info["webhook"]["url"].endswith(f"/hooks/{gid}/{telegram.sign(gid)}")
    assert (await client.post(f"/hooks/{gid}/deadbeef", json={"topic": "x"})).status_code == 404

    r = await client.post(info["webhook"]["url"].replace("http://test", ""), json={"topic": "w"})
    assert r.status_code == 202, r.text
    run = await wait_for(client, r.json()["id"], "paused")
    assert run["input"] == {"topic": "w"}
    # nobody connected Telegram for this graph: nothing is sent
    assert not [m for m, _ in triggers if m == "sendMessage"]


@pytest.mark.anyio
async def test_non_object_body_becomes_payload(client, monkeypatch, triggers):
    checkpointer.use_memory()
    script(monkeypatch, ["d"])
    gid = (await client.post("/graphs", json=EXAMPLE)).json()["id"]
    url = f"/hooks/{gid}/{telegram.sign(gid)}"
    r = await client.post(url, content=b"plain text", headers={"content-type": "text/plain"})
    assert r.status_code == 202
    run = (await client.get(f"/runs/{r.json()['id']}")).json()
    assert run["input"] == {"payload": "plain text"}


@pytest.mark.anyio
async def test_connect_link_binds_chat_and_paused_run_is_sent_there(client, monkeypatch, triggers):
    checkpointer.use_memory()
    script(monkeypatch, ["draft one"])
    gid = (await client.post("/graphs", json=EXAMPLE)).json()["id"]
    info = (await client.get(f"/graphs/{gid}/triggers")).json()["telegram"]
    assert info["bot"] and info["linked"] is False
    assert info["connect_url"].startswith("https://t.me/TestGateBot?start=")

    await link(client, gid, 777)
    assert "Connected to" in triggers[-1][1]["text"] and triggers[-1][1]["chat_id"] == 777
    info = (await client.get(f"/graphs/{gid}/triggers")).json()["telegram"]
    assert info["linked"] is True and info["connect_url"] is None

    rid = (await client.post("/runs", json={"graph_id": gid, "input": {"topic": "t"}})).json()["id"]
    run = await wait_for(client, rid, "paused")
    _, payload = next(x for x in triggers if x[0] == "sendMessage" and "draft one" in x[1]["text"])
    assert payload["chat_id"] == "777"
    buttons = payload["reply_markup"]["inline_keyboard"][0]
    assert [b["text"] for b in buttons] == ["Yes", "No"]
    assert buttons[0]["callback_data"] == f"r:{run['id']}:yes"


@pytest.mark.anyio
async def test_button_resumes_only_from_the_bound_chat(client, monkeypatch, triggers):
    checkpointer.use_memory()
    script(monkeypatch, ["draft one"])
    gid = (await client.post("/graphs", json=EXAMPLE)).json()["id"]
    await link(client, gid, 777)
    rid = (await client.post("/runs", json={"graph_id": gid, "input": {"topic": "t"}})).json()["id"]
    await wait_for(client, rid, "paused")

    def press(chat: int, cid: str) -> dict:
        msg = {"chat": {"id": chat}, "message_id": 5, "text": "q"}
        return {"callback_query": {"id": cid, "data": f"r:{rid}:yes", "message": msg}}

    assert (await client.post(tg_path(), json=press(999, "1"))).status_code == 200
    assert (await client.get(f"/runs/{rid}")).json()["status"] == "paused"
    assert "not connected" in triggers[-1][1]["text"]

    assert (await client.post(tg_path(), json=press(777, "2"))).status_code == 200
    run = await wait_for(client, rid, "done")
    assert run["status"] == "done" and run["output"]["decision"] == "yes"
    methods = [m for m, _ in triggers]
    assert "answerCallbackQuery" in methods and "editMessageText" in methods

    assert (await client.post(tg_path(), json=press(777, "3"))).status_code == 200  # no-op now
    assert (await client.post(TG + "nope", json=press(777, "4"))).status_code == 404


@pytest.mark.anyio
async def test_unlink_stops_notifications(client, monkeypatch, triggers):
    checkpointer.use_memory()
    script(monkeypatch, ["d"])
    gid = (await client.post("/graphs", json=EXAMPLE)).json()["id"]
    await link(client, gid, 777)
    assert (await client.delete(f"/graphs/{gid}/telegram")).status_code == 204
    assert (await client.get(f"/graphs/{gid}/triggers")).json()["telegram"]["linked"] is False
    triggers.clear()
    rid = (await client.post("/runs", json={"graph_id": gid, "input": {"topic": "t"}})).json()["id"]
    await wait_for(client, rid, "paused")
    assert not [m for m, _ in triggers if m == "sendMessage"]


@pytest.mark.anyio
async def test_plain_or_forged_start_does_not_bind(client, triggers):
    gid = (await client.post("/graphs", json=EXAMPLE)).json()["id"]
    for text in ("/start", "/start " + "0" * 48, f"/start {uuid.UUID(gid).hex}{'f' * 16}"):
        upd = {"message": {"chat": {"id": 4242}, "text": text}}
        assert (await client.post(tg_path(), json=upd)).status_code == 200
        assert "Connect Telegram" in triggers[-1][1]["text"]
    assert (await client.get(f"/graphs/{gid}/triggers")).json()["telegram"]["linked"] is False


def test_link_param_roundtrip(monkeypatch):
    monkeypatch.setattr(settings, "webhook_secret", "s")
    gid = uuid.uuid4()
    assert telegram.parse_link(telegram.link_param(gid)) == gid
    assert telegram.parse_link(telegram.link_param(gid)[:-1] + "0") is None
    assert telegram.parse_link("") is None


def test_open_link_only_for_https(monkeypatch):
    monkeypatch.setattr(settings, "cors_origins", "http://localhost:3000")
    intr = {"question": "ok? (yes/no)"}
    kb = telegram.build_message("1", uuid.uuid4(), uuid.uuid4(), "g", intr)["reply_markup"][
        "inline_keyboard"
    ]
    assert len(kb) == 1
    monkeypatch.setattr(
        settings, "cors_origins", "https://studio.example.com, http://localhost:3000"
    )
    kb = telegram.build_message("1", uuid.uuid4(), uuid.uuid4(), "g", intr)["reply_markup"][
        "inline_keyboard"
    ]
    assert kb[1][0]["url"].startswith("https://studio.example.com/graphs/")


def test_quick_answers():
    assert telegram.quick_answers("Approve this draft? (yes/no)") == ["yes", "no"]
    assert telegram.quick_answers("Pick one (ship/revise/drop)") == ["ship", "revise", "drop"]
    assert telegram.quick_answers("Anything to add?") == ["yes", "no"]
