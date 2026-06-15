"""Add address_label to route_stops for reverse-geocoded stop labels.

Revision ID: 20250608_0006
Revises: 20250526_0005
Create Date: 2026-06-08
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20250608_0006"
down_revision: Union[str, None] = "20250526_0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "route_stops",
        sa.Column("address_label", sa.String(length=200), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("route_stops", "address_label")
