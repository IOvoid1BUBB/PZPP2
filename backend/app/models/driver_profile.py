"""Driver profile ORM model — per-driver stop-cost and contract parameters."""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Numeric, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.session import ConsolidationSession


class DriverProfile(Base):
    __tablename__ = "driver_profiles"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    hourly_cost_eur: Mapped[float] = mapped_column(Numeric(6, 2), nullable=False)
    idle_fuel_l_per_hour: Mapped[float] = mapped_column(Numeric(4, 2), nullable=False)
    stop_admin_fee_eur: Mapped[float] = mapped_column(Numeric(6, 2), nullable=False)

    consolidation_sessions: Mapped[list[ConsolidationSession]] = relationship(
        back_populates="driver_profile",
    )
