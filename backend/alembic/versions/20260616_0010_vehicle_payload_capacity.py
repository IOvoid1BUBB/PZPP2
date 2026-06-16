"""Set realistic payload capacities: Master vans 1.5t, MAN solo 12t.

Revision ID: 20260616_0010
Revises: 20260616_0009
Create Date: 2026-06-16
"""

from __future__ import annotations

from alembic import op

revision = "20260616_0010"
down_revision = "20260616_0009"
branch_labels = None
depends_on = None

_MASTER_TYPES = ("master_l2", "master_l3", "master_l4")
_MASTER_PAYLOAD_KG = 1500
_SOLO_PAYLOAD_KG = 12000


def upgrade() -> None:
    for vtype in _MASTER_TYPES:
        op.execute(
            f"UPDATE vehicle_types SET max_weight_kg = {_MASTER_PAYLOAD_KG} "
            f"WHERE type = '{vtype}'"
        )
    op.execute(
        f"UPDATE vehicle_types SET max_weight_kg = {_SOLO_PAYLOAD_KG} "
        "WHERE type = 'man_solo'"
    )


def downgrade() -> None:
    op.execute("UPDATE vehicle_types SET max_weight_kg = 3500 WHERE type = 'master_l2'")
    op.execute("UPDATE vehicle_types SET max_weight_kg = 3600 WHERE type = 'master_l3'")
    op.execute("UPDATE vehicle_types SET max_weight_kg = 3800 WHERE type = 'master_l4'")
    op.execute("UPDATE vehicle_types SET max_weight_kg = 24000 WHERE type = 'man_solo'")
