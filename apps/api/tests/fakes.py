"""A scripted chat model so engine tests never touch a real provider."""

from langchain_core.language_models.fake_chat_models import FakeListChatModel
from langchain_core.messages import AIMessage


class ScriptedChat(FakeListChatModel):
    """Returns responses in order and attaches fake usage so cost accounting is exercised."""

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        result = super()._generate(messages, stop=stop, run_manager=run_manager, **kwargs)
        gen = result.generations[0]
        gen.message = AIMessage(
            content=gen.message.content,
            usage_metadata={"input_tokens": 10, "output_tokens": 5, "total_tokens": 15},
        )
        return result


def script(monkeypatch, responses: list[str]) -> ScriptedChat:
    chat = ScriptedChat(responses=responses)
    monkeypatch.setattr("app.engine.runners.get_chat_model", lambda *a, **k: chat)
    return chat
