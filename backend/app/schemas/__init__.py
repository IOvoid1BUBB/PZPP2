"""Pydantic v2 schemas (API contracts).

This package is checked under mypy strict mode (see ``pyproject.toml``).
"""

from __future__ import annotations

from app.schemas.common import ErrorResponse, HealthResponse
from app.schemas.offer import OfferRead
from app.schemas.session import SessionCreate, SessionRead, SessionUpdate
from app.schemas.solver import SolverRequest, SolverResponse
from app.schemas.stop import StopRead
from app.schemas.vehicle import VehicleRead

__all__ = [
    "ErrorResponse",
    "HealthResponse",
    "OfferRead",
    "SessionCreate",
    "SessionRead",
    "SessionUpdate",
    "SolverRequest",
    "SolverResponse",
    "StopRead",
    "VehicleRead",
]
