"""ConsolidationSession ORM model."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Numeric, String, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.cost import CostEvent
    from app.models.solver import SolverResult
    from app.models.stop import RouteStop
    from app.models.vehicle import Vehicle


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
    route_stops: Mapped[list[RouteStop]] = relationship(back_populates="session")
    solver_results: Mapped[list[SolverResult]] = relationship(back_populates="session")
    cost_events: Mapped[list[CostEvent]] = relationship(back_populates="session")
