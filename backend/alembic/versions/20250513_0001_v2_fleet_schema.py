"""PostGIS fleet schema v2: vehicles, offers, consolidation, route stops, solver, costs.

Revision ID: 20250513_0001
Revises:
Create Date: 2026-05-13

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from geoalchemy2 import Geometry
from sqlalchemy.dialects import postgresql

revision: str = "20250513_0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(sa.text("CREATE EXTENSION IF NOT EXISTS postgis"))

    op.create_table(
        "vehicles",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("type", sa.String(length=20), nullable=False),
        sa.Column("max_ldm", sa.Numeric(5, 2), nullable=False),
        sa.Column("max_weight_kg", sa.Integer(), nullable=False),
        sa.Column("trailer_length_cm", sa.SmallInteger(), nullable=False),
        sa.Column("trailer_width_cm", sa.SmallInteger(), nullable=False),
        sa.Column("fuel_per_100km_base", sa.Numeric(4, 2), nullable=False),
        sa.Column(
            "max_stops",
            sa.SmallInteger(),
            server_default=sa.text("6"),
            nullable=False,
        ),
        sa.Column("payload_slots", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.CheckConstraint(
            "type IN ('bus_8','bus_9','bus_10','solo')",
            name="ck_vehicles_type",
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "market_offers",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "pickup_point",
            Geometry(geometry_type="POINT", srid=4326, spatial_index=False),
            nullable=False,
        ),
        sa.Column(
            "delivery_point",
            Geometry(geometry_type="POINT", srid=4326, spatial_index=False),
            nullable=False,
        ),
        sa.Column("ldm", sa.Numeric(4, 2), nullable=False),
        sa.Column("weight_kg", sa.Integer(), nullable=False),
        sa.Column("price_eur", sa.Numeric(10, 2), nullable=False),
        sa.Column("time_window_open", sa.DateTime(timezone=True), nullable=True),
        sa.Column("time_window_close", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "handling_time_minutes",
            sa.SmallInteger(),
            server_default=sa.text("30"),
            nullable=True,
        ),
        sa.Column("stackable", sa.Boolean(), server_default=sa.text("true"), nullable=True),
        sa.Column(
            "is_within_corridor",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=True,
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "consolidation_sessions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("vehicle_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.Column("total_revenue_eur", sa.Numeric(10, 2), nullable=True),
        sa.Column("net_profit_eur", sa.Numeric(10, 2), nullable=True),
        sa.Column("solver_run_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('draft','optimizing','confirmed','dispatched')",
            name="ck_consolidation_sessions_status",
        ),
        sa.ForeignKeyConstraint(
            ["vehicle_id"],
            ["vehicles.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "route_stops",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("offer_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("stop_type", sa.String(length=10), nullable=False),
        sa.Column("sequence_order", sa.SmallInteger(), nullable=False),
        sa.Column(
            "location",
            Geometry(geometry_type="POINT", srid=4326, spatial_index=False),
            nullable=False,
        ),
        sa.Column("eta_minutes_from_start", sa.Integer(), nullable=True),
        sa.Column("stop_cost_eur", sa.Numeric(8, 4), nullable=True),
        sa.CheckConstraint(
            "stop_type IN ('pickup','delivery')",
            name="ck_route_stops_stop_type",
        ),
        sa.CheckConstraint("sequence_order >= 0", name="ck_route_stops_sequence_order"),
        sa.ForeignKeyConstraint(
            ["offer_id"],
            ["market_offers.id"],
        ),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["consolidation_sessions.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "solver_results",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "selected_offer_ids",
            postgresql.ARRAY(postgresql.UUID(as_uuid=True)),
            nullable=False,
        ),
        sa.Column("stop_sequence_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("objective_value", sa.Numeric(10, 4), nullable=True),
        sa.Column("solver_status", sa.String(length=20), nullable=True),
        sa.Column("solve_time_ms", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["consolidation_sessions.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "cost_events",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("cost_type", sa.String(length=20), nullable=False),
        sa.Column("amount_eur", sa.Numeric(10, 4), nullable=False),
        sa.Column(
            "computed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "cost_type IN ('fuel','toll','driver','maintenance','stop')",
            name="ck_cost_events_cost_type",
        ),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["consolidation_sessions.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_index(
        "ix_market_offers_pickup_point_gist",
        "market_offers",
        ["pickup_point"],
        unique=False,
        postgresql_using="gist",
    )
    op.create_index(
        "ix_market_offers_delivery_point_gist",
        "market_offers",
        ["delivery_point"],
        unique=False,
        postgresql_using="gist",
    )
    op.create_index(
        "ix_route_stops_location_gist",
        "route_stops",
        ["location"],
        unique=False,
        postgresql_using="gist",
    )
    op.create_index(
        "ix_route_stops_session_id",
        "route_stops",
        ["session_id"],
        unique=False,
    )
    op.create_index(
        "ix_route_stops_sequence_order",
        "route_stops",
        ["sequence_order"],
        unique=False,
    )
    op.create_index(
        "ix_consolidation_sessions_status",
        "consolidation_sessions",
        ["status"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_consolidation_sessions_status", table_name="consolidation_sessions")
    op.drop_index("ix_route_stops_sequence_order", table_name="route_stops")
    op.drop_index("ix_route_stops_session_id", table_name="route_stops")
    op.drop_index("ix_route_stops_location_gist", table_name="route_stops")
    op.drop_index("ix_market_offers_delivery_point_gist", table_name="market_offers")
    op.drop_index("ix_market_offers_pickup_point_gist", table_name="market_offers")

    op.drop_table("cost_events")
    op.drop_table("solver_results")
    op.drop_table("route_stops")
    op.drop_table("consolidation_sessions")
    op.drop_table("market_offers")
    op.drop_table("vehicles")
