"""Vehicle ORM model."""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Any

from sqlalchemy import CheckConstraint, Integer, Numeric, SmallInteger, String, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.session import ConsolidationSession


class Vehicle(Base):
    __tablename__ = "vehicles"
    __table_args__ = (
        CheckConstraint(
            "type IN ('master_l2','master_l3','master_l4','man_solo')",
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
    payload_slots: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)

    consolidation_sessions: Mapped[list[ConsolidationSession]] = relationship(
        back_populates="vehicle",
    )
