"""ORM models package.

Re-exports `Base` and every concrete model so that legacy imports such as
``from app.models import Base, Vehicle`` continue to work (e.g. in ``alembic/env.py``).
"""

from __future__ import annotations

from app.models.base import Base
from app.models.cost import CostEvent
from app.models.driver_profile import DriverProfile
from app.models.fleet_vehicle import FleetVehicle
from app.models.offer import MarketOffer
from app.models.session import ConsolidationSession
from app.models.solver import SolverResult
from app.models.stop import RouteStop
from app.models.vehicle import Vehicle, VehicleType
from app.models.weekly_driving_record import WeeklyDrivingRecord

__all__ = [
    "Base",
    "ConsolidationSession",
    "CostEvent",
    "DriverProfile",
    "FleetVehicle",
    "MarketOffer",
    "RouteStop",
    "SolverResult",
    "Vehicle",
    "VehicleType",
    "WeeklyDrivingRecord",
]
