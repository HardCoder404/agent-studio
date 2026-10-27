"""run checkpoint pointers

Revision ID: 348b5be4d4b9
Revises: 19b377e6f036
Create Date: 2026-10-27

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "348b5be4d4b9"
down_revision: str | None = "19b377e6f036"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("runs", sa.Column("fork_checkpoint_id", sa.String(length=64), nullable=True))
    op.add_column("runs", sa.Column("head_checkpoint_id", sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column("runs", "head_checkpoint_id")
    op.drop_column("runs", "fork_checkpoint_id")
