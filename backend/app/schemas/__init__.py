"""Pydantic v2 schemas (API contracts).

This package is checked under mypy strict mode (see ``pyproject.toml``).
"""

from __future__ import annotations

from app.schemas.common import ErrorResponse, HealthResponse
from app.schemas.offer import OfferRead
from app.schemas.session import (
    SessionCreate,
    SessionCreatedResponse,
    SessionFullResponse,
    SessionMetrics,
    SessionRead,
    SessionStatusUpdate,
)
from app.schemas.profit import SessionProfitBreakdown
from app.schemas.solver import SolverRequest, SolverResponse, SolverRunResult
from app.schemas.stop import StopRead
from app.schemas.vehicle import VehicleRead

__all__ = [
    "ErrorResponse",
    "HealthResponse",
    "OfferRead",
    "SessionCreate",
    "SessionCreatedResponse",
    "SessionFullResponse",
    "SessionMetrics",
    "SessionProfitBreakdown",
    "SessionRead",
    "SessionStatusUpdate",
    "SolverRequest",
    "SolverResponse",
    "SolverRunResult",
    "StopRead",
    "VehicleRead",
]
