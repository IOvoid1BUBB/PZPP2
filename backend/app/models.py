"""SQLAlchemy 2.0 declarative models for fleet / VRP schema (PostgreSQL + PostGIS)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

import geoalchemy2  # noqa: F401 — registers Geometry with SQLAlchemy for migrations
from geoalchemy2 import Geometry
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Vehicle(Base):
    __tablename__ = "vehicles"
    __table_args__ = (
        CheckConstraint(
            "type IN ('bus_8','bus_9','bus_10','solo')",
            name="ck_vehicles_type",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    max_ldm: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False)
    max_weight_kg: Mapped[int] = mapped_column(Integer, nullable=False)
    trailer_length_cm: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    trailer_width_cm: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    fuel_per_100km_base: Mapped[float] = mapped_column(Numeric(4, 2), nullable=False)
    max_stops: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default=text("6"))
    payload_slots: Mapped[dict] = mapped_column(JSONB, nullable=False)

    consolidation_sessions: Mapped[list["ConsolidationSession"]] = relationship(
        back_populates="vehicle",
    )


class ConsolidationSession(Base):
    __tablename__ = "consolidation_sessions"
    __table_args__ = (
        CheckConstraint(
            "status IN ('draft','optimizing','confirmed','dispatched')",
            name="ck_consolidation_sessions_status",
        ),
        Index("ix_consolidation_sessions_status", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    vehicle_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("vehicles.id"),
        nullable=True,
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    total_revenue_eur: Mapped[float | None] = mapped_column(Numeric(10, 2))
    net_profit_eur: Mapped[float | None] = mapped_column(Numeric(10, 2))
    solver_run_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))

    vehicle: Mapped[Vehicle | None] = relationship(back_populates="consolidation_sessions")
    route_stops: Mapped[list["RouteStop"]] = relationship(back_populates="session")
    solver_results: Mapped[list["SolverResult"]] = relationship(back_populates="session")
    cost_events: Mapped[list["CostEvent"]] = relationship(back_populates="session")


class MarketOffer(Base):
    __tablename__ = "market_offers"
    __table_args__ = (
        Index(
            "ix_market_offers_pickup_point_gist",
            "pickup_point",
            postgresql_using="gist",
        ),
        Index(
            "ix_market_offers_delivery_point_gist",
            "delivery_point",
            postgresql_using="gist",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    pickup_point: Mapped[Any] = mapped_column(
        Geometry("POINT", srid=4326, spatial_index=False),
        nullable=False,
    )
    delivery_point: Mapped[Any] = mapped_column(
        Geometry("POINT", srid=4326, spatial_index=False),
        nullable=False,
    )
    ldm: Mapped[float] = mapped_column(Numeric(4, 2), nullable=False)
    weight_kg: Mapped[int] = mapped_column(Integer, nullable=False)
    price_eur: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    time_window_open: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    time_window_close: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    handling_time_minutes: Mapped[int | None] = mapped_column(
        SmallInteger,
        server_default=text("30"),
    )
    stackable: Mapped[bool | None] = mapped_column(Boolean, server_default=text("true"))
    is_within_corridor: Mapped[bool | None] = mapped_column(
        Boolean,
        server_default=text("false"),
    )

    route_stops: Mapped[list["RouteStop"]] = relationship(back_populates="offer")


class RouteStop(Base):
    __tablename__ = "route_stops"
    __table_args__ = (
        CheckConstraint(
            "stop_type IN ('pickup','delivery')",
            name="ck_route_stops_stop_type",
        ),
        CheckConstraint("sequence_order >= 0", name="ck_route_stops_sequence_order"),
        Index("ix_route_stops_session_id", "session_id"),
        Index("ix_route_stops_sequence_order", "sequence_order"),
        Index("ix_route_stops_location_gist", "location", postgresql_using="gist"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("consolidation_sessions.id"),
        nullable=False,
    )
    offer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("market_offers.id"),
        nullable=False,
    )
    stop_type: Mapped[str] = mapped_column(String(10), nullable=False)
    sequence_order: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    location: Mapped[Any] = mapped_column(
        Geometry("POINT", srid=4326, spatial_index=False),
        nullable=False,
    )
    eta_minutes_from_start: Mapped[int | None] = mapped_column(Integer)
    stop_cost_eur: Mapped[float | None] = mapped_column(Numeric(8, 4))

    session: Mapped["ConsolidationSession"] = relationship(back_populates="route_stops")
    offer: Mapped["MarketOffer"] = relationship(back_populates="route_stops")


class SolverResult(Base):
    __tablename__ = "solver_results"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("consolidation_sessions.id"),
        nullable=False,
    )
    selected_offer_ids: Mapped[list[uuid.UUID]] = mapped_column(
        ARRAY(UUID(as_uuid=True)),
        nullable=False,
    )
    stop_sequence_json: Mapped[dict | None] = mapped_column(JSONB)
    objective_value: Mapped[float | None] = mapped_column(Numeric(10, 4))
    solver_status: Mapped[str | None] = mapped_column(String(20))
    solve_time_ms: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )

    session: Mapped["ConsolidationSession"] = relationship(back_populates="solver_results")


class CostEvent(Base):
    __tablename__ = "cost_events"
    __table_args__ = (
        CheckConstraint(
            "cost_type IN ('fuel','toll','driver','maintenance','stop')",
            name="ck_cost_events_cost_type",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("consolidation_sessions.id"),
        nullable=False,
    )
    cost_type: Mapped[str] = mapped_column(String(20), nullable=False)
    amount_eur: Mapped[float] = mapped_column(Numeric(10, 4), nullable=False)
    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )

    session: Mapped["ConsolidationSession"] = relationship(back_populates="cost_events")
