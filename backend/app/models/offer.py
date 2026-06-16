"""MarketOffer ORM model."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from geoalchemy2 import Geometry
from sqlalchemy import Boolean, DateTime, Index, Integer, Numeric, SmallInteger, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.stop import RouteStop


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
    pickup_label: Mapped[str | None] = mapped_column(String(200))
    delivery_label: Mapped[str | None] = mapped_column(String(200))
    shipper_company: Mapped[str | None] = mapped_column(String(100))

    route_stops: Mapped[list[RouteStop]] = relationship(back_populates="offer")
