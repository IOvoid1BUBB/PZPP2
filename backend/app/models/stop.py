"""RouteStop ORM model."""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Any

from geoalchemy2 import Geometry
from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.offer import MarketOffer
    from app.models.session import ConsolidationSession


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
    address_label: Mapped[str | None] = mapped_column(String(200), nullable=True)

    session: Mapped[ConsolidationSession] = relationship(back_populates="route_stops")
    offer: Mapped[MarketOffer] = relationship(back_populates="route_stops")
