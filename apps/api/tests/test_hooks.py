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
    monkeypatch.setattr(settings, "telegram_chat_id", "777")
    sent: list[tuple[str, dict]] = []

    async def fake_call(method: str, **payload):
        sent.append((method, payload))
        return {"ok": True, "result": {}}

    monkeypatch.setattr(telegram, "call", fake_call)
    return sent


@pytest.mark.anyio
async def test_triggers_disabled_without_secret(client, monkeypatch):
    monkeypatch.setattr(settings, "webhook_secret", "")
    gid = (await client.post("/graphs", json=EXAMPLE)).json()["id"]
    info = (await client.get(f"/graphs/{gid}/triggers")).json()
    assert info["webhook"]["enabled"] is False and info["webhook"]["url"] is None
    assert (await client.post(f"/hooks/{gid}/whatever", json={})).status_code == 404


@pytest.mark.anyio
async def test_webhook_starts_a_run_and_bad_token_is_404(client, monkeypatch, triggers):
    checkpointer.use_memory()
    script(monkeypatch, ["draft one"])
    gid = (await client.post("/graphs", json=EXAMPLE)).json()["id"]
    info = (await client.get(f"/graphs/{gid}/triggers")).json()
    assert info["webhook"]["enabled"] and info["webhook"]["url"].endswith(
        f"/hooks/{gid}/{telegram.sign(gid)}"
    )
    assert info["telegram"]["enabled"] is True

    assert (await client.post(f"/hooks/{gid}/deadbeef", json={"topic": "x"})).status_code == 404

    r = await client.post(
        info["webhook"]["url"].replace("http://test", ""), json={"topic": "webhooks"}
    )
    assert r.status_code == 202, r.text
    run = await wait_for(client, r.json()["id"], "paused")
    assert run["input"] == {"topic": "webhooks"}

    # a paused run was pushed to Telegram with answer buttons
    methods = [m for m, _ in triggers]
    assert "sendMessage" in methods
    _, payload = next(x for x in triggers if x[0] == "sendMessage")
    assert payload["chat_id"] == "777" and "draft one" in payload["text"]
    buttons = payload["reply_markup"]["inline_keyboard"][0]
    assert [b["text"] for b in buttons] == ["Yes", "No"]
    assert buttons[0]["callback_data"] == f"r:{run['id']}:yes"


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
async def test_telegram_button_resumes_the_run(client, monkeypatch, triggers):
    checkpointer.use_memory()
    script(monkeypatch, ["draft one"])
    gid = (await client.post("/graphs", json=EXAMPLE)).json()["id"]
    rid = (await client.post("/runs", json={"graph_id": gid, "input": {"topic": "t"}})).json()["id"]
    await wait_for(client, rid, "paused")
    tg = f"/hooks/telegram/{telegram.sign('telegram')}"

    # wrong chat: refused politely, run stays paused
    bad = {
        "callback_query": {
            "id": "1",
            "data": f"r:{rid}:yes",
            "message": {"chat": {"id": 999}, "message_id": 5, "text": "q"},
        }
    }
    assert (await client.post(tg, json=bad)).status_code == 200
    assert (await client.get(f"/runs/{rid}")).json()["status"] == "paused"

    good = {
        "callback_query": {
            "id": "2",
            "data": f"r:{rid}:yes",
            "message": {"chat": {"id": 777}, "message_id": 5, "text": "q"},
        }
    }
    assert (await client.post(tg, json=good)).status_code == 200
    run = await wait_for(client, rid, "done")
    assert run["status"] == "done" and run["output"]["decision"] == "yes"
    methods = [m for m, _ in triggers]
    assert "answerCallbackQuery" in methods and "editMessageText" in methods

    # pressing again on a finished run is a no-op with a note
    assert (await client.post(tg, json=good)).status_code == 200
    assert (await client.post("/hooks/telegram/nope", json=good)).status_code == 404


@pytest.mark.anyio
async def test_start_message_replies_with_chat_id(client, triggers):
    tg = f"/hooks/telegram/{telegram.sign('telegram')}"
    upd = {"message": {"chat": {"id": 4242}, "text": "/start"}}
    assert (await client.post(tg, json=upd)).status_code == 200
    method, payload = triggers[-1]
    assert method == "sendMessage" and payload["chat_id"] == 4242 and "4242" in payload["text"]


def test_open_link_only_for_https(monkeypatch):
    import uuid

    monkeypatch.setattr(settings, "telegram_chat_id", "1")
    monkeypatch.setattr(settings, "cors_origins", "http://localhost:3000")
    intr = {"question": "ok? (yes/no)"}
    kb = telegram.build_message(uuid.uuid4(), uuid.uuid4(), "g", intr)["reply_markup"][
        "inline_keyboard"
    ]
    assert len(kb) == 1  # answers only, no localhost link
    monkeypatch.setattr(
        settings, "cors_origins", "https://studio.example.com, http://localhost:3000"
    )
    kb = telegram.build_message(uuid.uuid4(), uuid.uuid4(), "g", intr)["reply_markup"][
        "inline_keyboard"
    ]
    assert kb[1][0]["url"].startswith("https://studio.example.com/graphs/")


def test_quick_answers():
    assert telegram.quick_answers("Approve this draft? (yes/no)") == ["yes", "no"]
    assert telegram.quick_answers("Pick one (ship/revise/drop)") == ["ship", "revise", "drop"]
    assert telegram.quick_answers("Anything to add?") == ["yes", "no"]
