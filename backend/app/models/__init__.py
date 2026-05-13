"""ORM models package.

Re-exports `Base` and every concrete model so that legacy imports such as
``from app.models import Base, Vehicle`` continue to work (e.g. in ``alembic/env.py``).
"""

from __future__ import annotations

from app.models.base import Base
from app.models.cost import CostEvent
from app.models.offer import MarketOffer
from app.models.session import ConsolidationSession
from app.models.solver import SolverResult
from app.models.stop import RouteStop
from app.models.vehicle import Vehicle

__all__ = [
    "Base",
    "ConsolidationSession",
    "CostEvent",
    "MarketOffer",
    "RouteStop",
    "SolverResult",
    "Vehicle",
]
