"""Aggregate every domain router under the ``/api/v1`` prefix."""

from __future__ import annotations

from fastapi import APIRouter

from app.api import dashboard, driver_profiles, fleet, offers, planner, sessions, solver, stops, vehicles


def build_api_router() -> APIRouter:
    """Return a single ``/api/v1`` router with every sub-router mounted."""
    api = APIRouter(prefix="/api/v1")
    api.include_router(dashboard.router)
    api.include_router(planner.router)
    api.include_router(sessions.router)
    api.include_router(offers.router)
    api.include_router(driver_profiles.router)
    api.include_router(vehicles.router)
    api.include_router(fleet.router)
    api.include_router(solver.router)
    api.include_router(stops.router)
    return api
