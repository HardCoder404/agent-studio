"""Per-task context for the executor: which graph the current run belongs to. Tools read it so
`telegram_send` can find the chat bound to the graph without an explicit argument."""

from __future__ import annotations

import uuid
from contextvars import ContextVar

current_graph_id: ContextVar[uuid.UUID | None] = ContextVar("current_graph_id", default=None)
