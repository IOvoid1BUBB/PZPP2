"""Replace legacy bus/solo vehicle types with master_l2/l3/l4 and man_solo.

Revision ID: 20250526_0005
Revises: 20250519_0004
Create Date: 2026-05-26
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20250526_0005"
down_revision: Union[str, None] = "20250519_0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_LEGACY_TYPES = ("bus_8", "bus_9", "bus_10", "solo")
_NEW_TYPES = ("master_l2", "master_l3", "master_l4", "man_solo")


def upgrade() -> None:
    op.drop_constraint("ck_vehicles_type", "vehicles", type_="check")
    op.execute(
        sa.text(
            "DELETE FROM vehicles WHERE type IN ('bus_8','bus_9','bus_10','solo')",
        ),
    )
    op.create_check_constraint(
        "ck_vehicles_type",
        "vehicles",
        f"type IN ({','.join(repr(t) for t in _NEW_TYPES)})",
    )


def downgrade() -> None:
    op.drop_constraint("ck_vehicles_type", "vehicles", type_="check")
    op.execute(
        sa.text(
            "DELETE FROM vehicles WHERE type IN "
            "('master_l2','master_l3','master_l4','man_solo')",
        ),
    )
    op.create_check_constraint(
        "ck_vehicles_type",
        "vehicles",
        "type IN ('bus_8','bus_9','bus_10','solo')",
    )
