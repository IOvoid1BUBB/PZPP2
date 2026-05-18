"""Add origin and target region fields to consolidation_sessions.

Revision ID: 20250518_0002
Revises: 20250513_0001
Create Date: 2026-05-18

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20250518_0002"
down_revision: Union[str, None] = "20250513_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "consolidation_sessions",
        sa.Column("origin_lon", sa.Numeric(9, 6), nullable=True),
    )
    op.add_column(
        "consolidation_sessions",
        sa.Column("origin_lat", sa.Numeric(9, 6), nullable=True),
    )
    op.add_column(
        "consolidation_sessions",
        sa.Column(
            "target_region_bbox",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("consolidation_sessions", "target_region_bbox")
    op.drop_column("consolidation_sessions", "origin_lat")
    op.drop_column("consolidation_sessions", "origin_lon")
