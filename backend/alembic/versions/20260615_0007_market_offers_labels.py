"""Add human-readable labels to market_offers.

Revision ID: 20260615_0007
Revises: 20250608_0006
Create Date: 2026-06-15

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260615_0007"
down_revision: Union[str, None] = "20250608_0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "market_offers",
        sa.Column("pickup_label", sa.String(length=200), nullable=True),
    )
    op.add_column(
        "market_offers",
        sa.Column("delivery_label", sa.String(length=200), nullable=True),
    )
    op.add_column(
        "market_offers",
        sa.Column("shipper_company", sa.String(length=100), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("market_offers", "shipper_company")
    op.drop_column("market_offers", "delivery_label")
    op.drop_column("market_offers", "pickup_label")
