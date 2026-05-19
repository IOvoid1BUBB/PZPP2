"""Add load_layout JSONB to consolidation_sessions for SlotEditor state.

Revision ID: 20250519_0004
Revises: 20250518_0003
Create Date: 2026-05-19
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20250519_0004"
down_revision: Union[str, None] = "20250518_0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "consolidation_sessions",
        sa.Column("load_layout", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("consolidation_sessions", "load_layout")
