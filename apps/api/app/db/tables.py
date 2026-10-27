import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class Graph(Base):
    __tablename__ = "graphs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(120))
    version: Mapped[int] = mapped_column(Integer, default=1)
    spec: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Run(Base):
    __tablename__ = "runs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    graph_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("graphs.id", ondelete="CASCADE"), index=True
    )
    graph_version: Mapped[int] = mapped_column(Integer)
    thread_id: Mapped[str] = mapped_column(String(64), index=True)
    parent_run_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("runs.id"), nullable=True)
    fork_checkpoint_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True
    )  # where this run branched off
    head_checkpoint_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True
    )  # latest checkpoint of this run
    status: Mapped[str] = mapped_column(
        String(16), default="queued"
    )  # queued|running|paused|done|error
    input: Mapped[dict] = mapped_column(JSON, default=dict)
    output: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    interrupt: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    usage: Mapped[dict] = mapped_column(JSON, default=dict)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class RunEvent(Base):
    __tablename__ = "run_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), index=True)
    seq: Mapped[int] = mapped_column(Integer)
    type: Mapped[str] = mapped_column(String(32))
    node_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Dataset(Base):
    __tablename__ = "datasets"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    graph_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("graphs.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(120))
    rows: Mapped[list] = mapped_column(
        JSON, default=list
    )  # [{input: {...}, expected: ..., human: ...}]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class EvalRun(Base):
    __tablename__ = "eval_runs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    graph_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("graphs.id", ondelete="CASCADE"), index=True
    )
    graph_version: Mapped[int] = mapped_column(Integer)
    dataset_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"))
    scorers: Mapped[list] = mapped_column(JSON, default=list)
    sweep_id: Mapped[uuid.UUID | None] = mapped_column(
        nullable=True, index=True
    )  # groups sweep variants
    node_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True
    )  # node whose model varies
    variant: Mapped[str | None] = mapped_column(
        String(120), nullable=True
    )  # model tried for that node
    status: Mapped[str] = mapped_column(
        String(16), default="queued"
    )  # queued|running|done|error|cancelled
    total: Mapped[int] = mapped_column(Integer, default=0)
    completed: Mapped[int] = mapped_column(Integer, default=0)
    summary: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class EvalResult(Base):
    __tablename__ = "eval_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    eval_run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("eval_runs.id", ondelete="CASCADE"), index=True
    )
    row_index: Mapped[int] = mapped_column(Integer)
    run_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("runs.id", ondelete="SET NULL"), nullable=True
    )
    output: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    scores: Mapped[dict] = mapped_column(JSON, default=dict)  # scorer name -> Score dict
    usage: Mapped[dict] = mapped_column(JSON, default=dict)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
