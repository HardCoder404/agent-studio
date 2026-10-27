"""A scripted chat model so engine tests never touch a real provider."""

from collections.abc import AsyncIterator, Iterator

from langchain_core.language_models.fake_chat_models import FakeListChatModel
from langchain_core.messages import AIMessage, AIMessageChunk
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult

USAGE = {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}


class ScriptedChat(FakeListChatModel):
    """Returns responses in order, streams them word by word, and reports fake usage.

    Both the sync and async stream paths are overridden: LangGraph's `messages` stream
    mode drives `ainvoke` through `_astream`, not `_stream`.
    """

    def _next(self) -> str:
        text = self.responses[self.i]
        self.i = (self.i + 1) % len(self.responses)
        return text

    def _chunks(self) -> list[ChatGenerationChunk]:
        words = self._next().split(" ")
        out = []
        for i, w in enumerate(words):
            last = i == len(words) - 1
            text = w if last else w + " "
            msg = AIMessageChunk(content=text, usage_metadata=USAGE if last else None)
            out.append(ChatGenerationChunk(message=msg))
        return out

    def _generate(self, messages, stop=None, run_manager=None, **kwargs) -> ChatResult:
        msg = AIMessage(content=self._next(), usage_metadata=USAGE)
        return ChatResult(generations=[ChatGeneration(message=msg)])

    def _stream(
        self, messages, stop=None, run_manager=None, **kwargs
    ) -> Iterator[ChatGenerationChunk]:
        for chunk in self._chunks():
            if run_manager:
                run_manager.on_llm_new_token(chunk.text, chunk=chunk)
            yield chunk

    async def _astream(
        self, messages, stop=None, run_manager=None, **kwargs
    ) -> AsyncIterator[ChatGenerationChunk]:
        for chunk in self._chunks():
            if run_manager:
                await run_manager.on_llm_new_token(chunk.text, chunk=chunk)
            yield chunk


def script(monkeypatch, responses: list[str]) -> ScriptedChat:
    chat = ScriptedChat(responses=responses)
    monkeypatch.setattr("app.engine.runners.get_chat_model", lambda *a, **k: chat)
    return chat
