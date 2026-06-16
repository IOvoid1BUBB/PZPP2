"""Split vehicles table into vehicle_types + fleet_vehicles.

vehicle_types: type catalog (renamed from vehicles, all 4 rows kept).
fleet_vehicles: physical fleet instances (FK → vehicle_types.id).
consolidation_sessions: keep vehicle_id FK (→ vehicle_types for compat),
add nullable fleet_vehicle_id FK (→ fleet_vehicles).

Revision ID: 20260616_0008
Revises: 20260616_0007
Create Date: 2026-06-16
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260616_0008"
down_revision: Union[str, None] = "20260616_0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Rename vehicles → vehicle_types
    op.rename_table("vehicles", "vehicle_types")

    # 2. Rename the FK constraint + index on consolidation_sessions
    #    (the FK column vehicle_id still references the same UUID rows — just
    #    the table is now called vehicle_types)
    with op.batch_alter_table("consolidation_sessions") as batch_op:
        # Drop old FK that references 'vehicles'
        batch_op.drop_constraint(
            "consolidation_sessions_vehicle_id_fkey",
            type_="foreignkey",
        )
        # Re-create FK pointing to new table name
        batch_op.create_foreign_key(
            "fk_consolidation_sessions_vehicle_id",
            "vehicle_types",
            ["vehicle_id"],
            ["id"],
        )
        # Add nullable fleet_vehicle_id FK
        batch_op.add_column(
            sa.Column(
                "fleet_vehicle_id",
                postgresql.UUID(as_uuid=True),
                nullable=True,
            )
        )

    # 3. Create fleet_vehicles table
    op.create_table(
        "fleet_vehicles",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "type_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("vehicle_types.id", name="fk_fleet_vehicles_type_id"),
            nullable=False,
        ),
        sa.Column("registration", sa.String(20), nullable=False, unique=True),
        sa.Column("display_name", sa.String(100), nullable=False),
        sa.Column(
            "status",
            sa.String(20),
            nullable=False,
            server_default="idle",
        ),
        sa.Column("home_lat", sa.Numeric(9, 6), nullable=True),
        sa.Column("home_lon", sa.Numeric(9, 6), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('idle','in_route','maintenance','retired')",
            name="ck_fleet_vehicles_status",
        ),
    )

    # 4. Add FK from consolidation_sessions.fleet_vehicle_id → fleet_vehicles.id
    with op.batch_alter_table("consolidation_sessions") as batch_op:
        batch_op.create_foreign_key(
            "fk_consolidation_sessions_fleet_vehicle_id",
            "fleet_vehicles",
            ["fleet_vehicle_id"],
            ["id"],
        )


def downgrade() -> None:
    with op.batch_alter_table("consolidation_sessions") as batch_op:
        batch_op.drop_constraint(
            "fk_consolidation_sessions_fleet_vehicle_id",
            type_="foreignkey",
        )
        batch_op.drop_column("fleet_vehicle_id")
        batch_op.drop_constraint(
            "fk_consolidation_sessions_vehicle_id",
            type_="foreignkey",
        )
        batch_op.create_foreign_key(
            "consolidation_sessions_vehicle_id_fkey",
            "vehicles",
            ["vehicle_id"],
            ["id"],
        )

    op.drop_table("fleet_vehicles")
    op.rename_table("vehicle_types", "vehicles")
