"""graph telegram chat

Revision ID: c7d4e2a91f30
Revises: 51e5c8e5d43c
Create Date: 2026-11-04 09:10:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c7d4e2a91f30"
down_revision: str | Sequence[str] | None = "51e5c8e5d43c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("graphs", sa.Column("telegram_chat_id", sa.String(length=32), nullable=True))


def downgrade() -> None:
    op.drop_column("graphs", "telegram_chat_id")
