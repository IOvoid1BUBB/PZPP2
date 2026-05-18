"""Add driver_profiles and link consolidation sessions to assigned driver.

Revision ID: 20250518_0003
Revises: 20250518_0002
Create Date: 2026-05-18

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20250518_0003"
down_revision: Union[str, None] = "20250518_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Deterministic UUIDs for default profiles (seed + backfill).
PROFILE_STANDARD_ID = "11111111-1111-4111-8111-111111110001"
PROFILE_SENIOR_ID = "11111111-1111-4111-8111-111111110002"
PROFILE_ECONOMY_ID = "11111111-1111-4111-8111-111111110003"


def upgrade() -> None:
    op.create_table(
        "driver_profiles",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("code", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("hourly_cost_eur", sa.Numeric(6, 2), nullable=False),
        sa.Column("idle_fuel_l_per_hour", sa.Numeric(4, 2), nullable=False),
        sa.Column("stop_admin_fee_eur", sa.Numeric(6, 2), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code", name="uq_driver_profiles_code"),
    )

    driver_profiles = sa.table(
        "driver_profiles",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("code", sa.String()),
        sa.column("name", sa.String()),
        sa.column("hourly_cost_eur", sa.Numeric()),
        sa.column("idle_fuel_l_per_hour", sa.Numeric()),
        sa.column("stop_admin_fee_eur", sa.Numeric()),
    )
    op.bulk_insert(
        driver_profiles,
        [
            {
                "id": PROFILE_STANDARD_ID,
                "code": "standard",
                "name": "Standard",
                "hourly_cost_eur": 18.0,
                "idle_fuel_l_per_hour": 2.5,
                "stop_admin_fee_eur": 5.0,
            },
            {
                "id": PROFILE_SENIOR_ID,
                "code": "senior",
                "name": "Senior",
                "hourly_cost_eur": 22.0,
                "idle_fuel_l_per_hour": 2.5,
                "stop_admin_fee_eur": 5.0,
            },
            {
                "id": PROFILE_ECONOMY_ID,
                "code": "economy",
                "name": "Economy",
                "hourly_cost_eur": 15.0,
                "idle_fuel_l_per_hour": 2.0,
                "stop_admin_fee_eur": 4.0,
            },
        ],
    )

    op.add_column(
        "consolidation_sessions",
        sa.Column("driver_profile_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.execute(
        sa.text(
            "UPDATE consolidation_sessions "
            f"SET driver_profile_id = '{PROFILE_STANDARD_ID}' "
            "WHERE driver_profile_id IS NULL",
        ),
    )
    op.alter_column("consolidation_sessions", "driver_profile_id", nullable=False)
    op.create_foreign_key(
        "fk_consolidation_sessions_driver_profile_id",
        "consolidation_sessions",
        "driver_profiles",
        ["driver_profile_id"],
        ["id"],
    )
    op.create_index(
        "ix_consolidation_sessions_driver_profile_id",
        "consolidation_sessions",
        ["driver_profile_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_consolidation_sessions_driver_profile_id", "consolidation_sessions")
    op.drop_constraint(
        "fk_consolidation_sessions_driver_profile_id",
        "consolidation_sessions",
        type_="foreignkey",
    )
    op.drop_column("consolidation_sessions", "driver_profile_id")
    op.drop_table("driver_profiles")
