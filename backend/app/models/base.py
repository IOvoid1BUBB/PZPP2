"""Declarative base class for all ORM models."""

from __future__ import annotations

import geoalchemy2  # noqa: F401  # registers Geometry type with SQLAlchemy
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Single declarative base used by every ORM model in the project."""
