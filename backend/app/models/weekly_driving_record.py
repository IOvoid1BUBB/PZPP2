"""WeeklyDrivingRecord ORM model — per-driver weekly driving history.

Tracks accumulated driving/working time for a single driver within one ISO
week (Monday-anchored) so the planner can enforce the EU 561/2006 art. 6(2)
weekly driving limit across multiple consolidation sessions.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    Date,
    DateTime,
    ForeignKey,
    Integer,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class WeeklyDrivingRecord(Base):
    __tablename__ = "weekly_driving_records"
    __table_args__ = (
        UniqueConstraint(
            "driver_profile_id",
            "week_start",
            name="uq_weekly_driving_records_driver_week",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    driver_profile_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("driver_profiles.id", name="fk_weekly_driving_records_driver_profile_id"),
        nullable=False,
    )
    week_start: Mapped[date] = mapped_column(Date, nullable=False)
    total_driving_minutes: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("0"),
    )
    total_working_minutes: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("0"),
    )
    session_ids: Mapped[list[Any]] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'[]'::jsonb"),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        onupdate=func.now(),
    )
