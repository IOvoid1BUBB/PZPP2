"""FleetVehicle ORM model — physical fleet instances."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Numeric, String, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.vehicle import Vehicle


class FleetVehicle(Base):
    __tablename__ = "fleet_vehicles"
    __table_args__ = (
        CheckConstraint(
            "status IN ('idle','in_route','maintenance','retired')",
            name="ck_fleet_vehicles_status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    type_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("vehicle_types.id", name="fk_fleet_vehicles_type_id"),
        nullable=False,
    )
    registration: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        server_default=text("'idle'"),
    )
    home_lat: Mapped[float | None] = mapped_column(Numeric(9, 6), nullable=True)
    home_lon: Mapped[float | None] = mapped_column(Numeric(9, 6), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    simulation_started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    vehicle_type: Mapped[Vehicle] = relationship(
        "Vehicle",
        foreign_keys=[type_id],
        lazy="joined",
    )
