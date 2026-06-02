"""CP-SAT offer selection solver for consolidation sessions.

Uses OR-Tools CP-SAT to maximise estimated net contribution across
candidate offers subject to hard LDM, weight, stop-count, and time-window
constraints.
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import Settings, get_settings
from app.core.exceptions import NotFoundError
from app.lib.geo import lat_lon_from_geometry
from app.models import ConsolidationSession, MarketOffer, RouteStop, SolverResult, Vehicle
from app.schemas.solver import SolverRunResult, SolverRunStatus
from app.services.offer_detour import COST_PER_KM_EUR, haversine_added_detour_km
from app.services.stop_cost_calculator import StopCostRates, calculate_stop_cost

_logger = logging.getLogger(__name__)

# Sentinel solve-time above which a warning is emitted.
_SLOW_SOLVE_MS = 8_000


def _time_windows_overlap(
    open_a: datetime | None,
    close_a: datetime | None,
    open_b: datetime | None,
    close_b: datetime | None,
) -> bool:
    """Return True when both offers have fully defined windows that overlap."""
    if None in (open_a, close_a, open_b, close_b):
        return False
    # Two intervals [a, b] and [c, d] overlap if a <= d and c <= b.
    return open_a <= close_b and open_b <= close_a  # type: ignore[operator]


def _solve_cp_sat(
    candidate_offers: list[MarketOffer],
    free_ldm: float,
    free_weight_kg: int,
    max_offer_slots: int,
    net_contributions_cents: list[int],
    time_limit_seconds: float,
) -> tuple[list[int], int, SolverRunStatus, bool, int]:
    """Run the CP-SAT model synchronously (called via asyncio.to_thread).

    Returns
    -------
    selected_indices : indices into candidate_offers that are selected
    objective_cents  : realised objective value in EUR-cents
    status           : solver status string
    is_optimal       : True when OPTIMAL
    solve_time_ms    : wall-clock solve time in milliseconds
    """
    from ortools.sat.python import cp_model  # lazy import — only needed here

    model = cp_model.CpModel()
    n = len(candidate_offers)

    x = [model.new_bool_var(f"x_{i}") for i in range(n)]

    # --- Hard constraints --------------------------------------------------

    # LDM capacity (scale to avoid floats: multiply by 10)
    ldm_cap = int(free_ldm * 10)
    model.add(
        sum(int(float(o.ldm) * 10) * x[i] for i, o in enumerate(candidate_offers))
        <= ldm_cap
    )

    # Weight capacity
    model.add(
        sum(int(o.weight_kg) * x[i] for i, o in enumerate(candidate_offers))
        <= int(free_weight_kg)
    )

    # Max offer count
    model.add(sum(x) <= max_offer_slots)

    # --- Soft: time-window conflicts (treated as hard exclusions) ----------
    for i in range(n):
        oi = candidate_offers[i]
        for j in range(i + 1, n):
            oj = candidate_offers[j]
            if _time_windows_overlap(
                oi.time_window_open,
                oi.time_window_close,
                oj.time_window_open,
                oj.time_window_close,
            ):
                model.add(x[i] + x[j] <= 1)

    # --- Objective: maximise net contribution (EUR-cents) -----------------
    model.maximize(
        sum(net_contributions_cents[i] * x[i] for i in range(n))
    )

    # --- Solver parameters ------------------------------------------------
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = float(time_limit_seconds)
    solver.parameters.num_search_workers = 4
    solver.parameters.random_seed = 42

    t0 = time.monotonic()
    status_code = solver.solve(model)
    elapsed_ms = int((time.monotonic() - t0) * 1000)

    status_map = {
        cp_model.OPTIMAL: ("OPTIMAL", True),
        cp_model.FEASIBLE: ("FEASIBLE", False),
        cp_model.INFEASIBLE: ("INFEASIBLE", False),
    }
    status_str, is_optimal = status_map.get(status_code, ("UNKNOWN", False))

    if status_str in ("OPTIMAL", "FEASIBLE"):
        selected = [i for i in range(n) if solver.value(x[i])]
        obj_cents = int(solver.objective_value)
    else:
        selected = []
        obj_cents = 0

    return selected, obj_cents, status_str, is_optimal, elapsed_ms  # type: ignore[return-value]


class VRPSolver:
    """Asynchronous wrapper around the CP-SAT model."""

    def __init__(
        self,
        db: AsyncSession,
        *,
        settings: Settings | None = None,
    ) -> None:
        self._db = db
        self._settings = settings or get_settings()

    async def solve(
        self,
        session_id: UUID,
        candidate_offer_ids: list[UUID],
        max_stops_override: int | None,
        time_limit_seconds: int,
    ) -> SolverRunResult:
        session = await self._load_session(session_id)
        if session is None:
            raise NotFoundError(f"Session {session_id} not found.")

        vehicle = session.vehicle
        if vehicle is None:
            from app.core.exceptions import ValidationAppError
            raise ValidationAppError("Session vehicle is not set.")

        driver_profile = session.driver_profile
        rates = StopCostRates.from_driver_profile(driver_profile)

        # Current capacity used by already-assigned offers
        used_ldm, used_weight_kg = self._current_capacity(session)
        free_ldm = float(vehicle.max_ldm) - used_ldm
        free_weight_kg = int(vehicle.max_weight_kg) - used_weight_kg

        # Max number of new offers that can be added
        existing_offer_count = sum(
            1 for s in session.route_stops if s.stop_type == "pickup"
        )
        vehicle_max_offers = vehicle.max_stops // 2
        remaining_slots = vehicle_max_offers - existing_offer_count
        if max_stops_override is not None:
            remaining_slots = min(remaining_slots, max_stops_override // 2)
        remaining_slots = max(0, remaining_slots)

        # Fetch candidate offers
        if not candidate_offer_ids:
            return self._empty_result(session_id, "INFEASIBLE", 0)

        candidates = await self._fetch_offers(candidate_offer_ids)
        if not candidates:
            raise NotFoundError("No candidate offers found for provided IDs.")

        # Build current waypoints for detour estimation
        origin = (
            (float(session.origin_lat), float(session.origin_lon))
            if session.origin_lat is not None and session.origin_lon is not None
            else (52.22, 21.01)
        )
        existing_waypoints: list[tuple[float, float]] = [origin] + [
            lat_lon_from_geometry(s.location)
            for s in sorted(session.route_stops, key=lambda s: s.sequence_order)
        ]

        # Estimate net contribution per offer (in EUR-cents)
        net_cents: list[int] = []
        for offer in candidates:
            stop_cost = calculate_stop_cost(
                offer.handling_time_minutes or 30,
                vehicle.type,
                rates=rates,
                fuel_price_eur_per_liter=self._settings.FUEL_PRICE_EUR_PER_LITER,
            )
            pickup_ll = lat_lon_from_geometry(offer.pickup_point)
            delivery_ll = lat_lon_from_geometry(offer.delivery_point)
            detour_km = haversine_added_detour_km(
                existing_waypoints, pickup_ll, delivery_ll
            )
            detour_cost = detour_km * COST_PER_KM_EUR
            net = float(offer.price_eur) - 2 * stop_cost.total_eur - detour_cost
            net_cents.append(int(net * 100))

        # Run CP-SAT in thread pool (non-blocking)
        selected_idx, obj_cents, status_str, is_optimal, elapsed_ms = (
            await asyncio.to_thread(
                _solve_cp_sat,
                candidates,
                free_ldm,
                free_weight_kg,
                remaining_slots,
                net_cents,
                float(time_limit_seconds),
            )
        )

        if elapsed_ms > _SLOW_SOLVE_MS:
            _logger.warning(
                "CP-SAT solve took %d ms (threshold %d ms)",
                elapsed_ms,
                _SLOW_SOLVE_MS,
                extra={
                    "event": "solver:slow",
                    "session_id": str(session_id),
                    "elapsed_ms": elapsed_ms,
                },
            )

        selected_offers = [candidates[i] for i in selected_idx]
        selected_ids = [o.id for o in selected_offers]
        objective_eur = round(obj_cents / 100, 2)

        # Persist solver result
        orm_result = SolverResult(
            session_id=session_id,
            selected_offer_ids=selected_ids,
            solver_status=status_str,
            objective_value=objective_eur,
            solve_time_ms=elapsed_ms,
        )
        self._db.add(orm_result)
        await self._db.flush()
        await self._db.refresh(orm_result)

        session.solver_run_id = orm_result.id
        await self._db.flush()

        return SolverRunResult(
            session_id=session_id,
            solver_run_id=orm_result.id,
            selected_offer_ids=selected_ids,
            objective_value=objective_eur,
            solver_status=status_str,  # type: ignore[arg-type]
            is_optimal=is_optimal,
            solve_time_ms=elapsed_ms,
        )

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    async def _load_session(self, session_id: UUID) -> ConsolidationSession | None:
        stmt = (
            select(ConsolidationSession)
            .where(ConsolidationSession.id == session_id)
            .options(
                selectinload(ConsolidationSession.vehicle),
                selectinload(ConsolidationSession.driver_profile),
                selectinload(ConsolidationSession.route_stops),
            )
        )
        result = await self._db.execute(stmt)
        return result.scalars().first()

    @staticmethod
    def _current_capacity(session: ConsolidationSession) -> tuple[float, int]:
        """Return (used_ldm, used_weight_kg) from existing pickup stops."""
        used_ldm = 0.0
        used_weight = 0
        for stop in session.route_stops:
            if stop.stop_type == "pickup" and stop.offer is not None:
                used_ldm += float(stop.offer.ldm)
                used_weight += int(stop.offer.weight_kg)
        return used_ldm, used_weight

    async def _fetch_offers(self, offer_ids: list[UUID]) -> list[MarketOffer]:
        stmt = (
            select(MarketOffer)
            .where(MarketOffer.id.in_(offer_ids))
        )
        result = await self._db.execute(stmt)
        return list(result.scalars().all())

    @staticmethod
    def _empty_result(
        session_id: UUID,
        status: SolverRunStatus,
        solve_time_ms: int,
    ) -> SolverRunResult:
        import uuid
        return SolverRunResult(
            session_id=session_id,
            solver_run_id=uuid.uuid4(),
            selected_offer_ids=[],
            objective_value=0.0,
            solver_status=status,
            is_optimal=False,
            solve_time_ms=solve_time_ms,
        )
