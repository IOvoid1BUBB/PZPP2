"""Add simulation_started_at to fleet_vehicles.

Revision ID: 20260616_0009
Revises: 20260616_0008
Create Date: 2026-06-16
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260616_0009"
down_revision: Union[str, None] = "20260616_0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "fleet_vehicles",
        sa.Column("simulation_started_at", sa.TIMESTAMP(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("fleet_vehicles", "simulation_started_at")
