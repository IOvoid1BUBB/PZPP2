"""Add deduplication unique index on market_offers.

Revision ID: 20250518_0002a
Revises: 20250518_0002
Create Date: 2026-05-18

"""

from typing import Sequence, Union

from alembic import op

revision: str = "20250518_0002a"
down_revision: Union[str, None] = "20250518_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE UNIQUE INDEX uq_market_offers_dedup
        ON market_offers (
            (pickup_point::text),
            (delivery_point::text),
            time_window_open
        )
        """,
    )


def downgrade() -> None:
    op.drop_index("uq_market_offers_dedup", table_name="market_offers")
