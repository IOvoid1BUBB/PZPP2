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
from uuid import UUID, uuid4

from geoalchemy2.types import Geography
from sqlalchemy import Select, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.exceptions import AppException, NotFoundError, ValidationAppError
from app.lib.geo import lat_lon_from_geometry
from app.lib.routing import RoutingProvider, get_routing_provider
from app.lib.session_loader import load_session
from app.models import ConsolidationSession, MarketOffer, RouteStop, SolverResult
from app.schemas.solver import (
    SolverJobStatus,
    SolverRunResult,
    SolverRunStatus,
    SolverStatusResponse,
    StopSequenceEntry,
)
from app.services.solver_job import SolverJobStore
from app.services.offer_detour import COST_PER_KM_EUR, haversine_added_detour_km
from app.services.offer_scorer import OfferScorerService
from app.services.planner_layout import build_layout_from_offers, slots_to_storage, vehicle_to_planner
from app.services.sequence_optimizer import (
    Stop,
    build_node_indices,
    optimize_stop_sequence,
)
from app.services.stop_cost_calculator import StopCostRates, calculate_stop_cost
from app.services.sessions import SessionService

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


def _solve_mock(
    candidate_offers: list[MarketOffer],
    free_ldm: float,
    free_weight_kg: int,
    max_offer_slots: int,
    net_contributions_cents: list[int],
    time_limit_seconds: float,
) -> tuple[list[int], int, SolverRunStatus, bool, int]:
    """Greedy mock solver for CI (no OR-Tools import).

    Mirrors the business logic of :func:`_solve_cp_sat`: respects LDM, weight,
    and stop-count capacity, and only ever picks offers with a positive net
    contribution. ``elapsed_ms`` is fixed at 1 as a marker that this is the mock.
    """
    ldm_cap = int(free_ldm * 10)
    order = sorted(
        (i for i in range(len(candidate_offers)) if net_contributions_cents[i] > 0),
        key=lambda i: net_contributions_cents[i],
        reverse=True,
    )

    selected: list[int] = []
    used_ldm = 0
    used_weight = 0
    for i in order:
        if len(selected) >= max_offer_slots:
            break
        offer = candidate_offers[i]
        offer_ldm = int(float(offer.ldm) * 10)
        offer_weight = int(offer.weight_kg)
        if used_ldm + offer_ldm > ldm_cap:
            continue
        if used_weight + offer_weight > free_weight_kg:
            continue
        selected.append(i)
        used_ldm += offer_ldm
        used_weight += offer_weight

    obj_cents = sum(net_contributions_cents[i] for i in selected)
    return selected, obj_cents, "OPTIMAL", True, 1


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
        routing: RoutingProvider | None = None,
        settings: Settings | None = None,
    ) -> None:
        self._db = db
        self._routing = routing or get_routing_provider()
        self._settings = settings or get_settings()
        self._session_service = SessionService(db, routing=self._routing, settings=self._settings)

    async def solve(
        self,
        session_id: UUID,
        candidate_offer_ids: list[UUID],
        max_stops_override: int | None,
        time_limit_seconds: int,
        use_full_market: bool = False,
    ) -> SolverRunResult:
        session = await self._load_session(session_id)
        if session is None:
            raise NotFoundError(f"Session {session_id} not found.")

        SessionService._ensure_draft(session)

        if session.origin_lat is None or session.origin_lon is None:
            raise AppException(
                detail=(
                    f"Session {session_id} has no origin coordinates. "
                    "Set origin_lat/origin_lon before running the solver."
                ),
                status_code=422,
                error_code="missing_origin",
            )

        vehicle = session.vehicle
        if vehicle is None:
            raise ValidationAppError("Session vehicle is not set.")

        driver_profile = session.driver_profile
        rates = StopCostRates.from_driver_profile(driver_profile)

        # Full vehicle capacity — replace semantics
        free_ldm = float(vehicle.max_ldm)
        free_weight_kg = int(vehicle.max_weight_kg)
        max_offer_slots = min(
            vehicle.max_stops // 2,
            self._settings.MAX_STOPS_PER_ROUTE // 2,
        )
        if max_stops_override is not None:
            max_offer_slots = min(max_offer_slots, max_stops_override // 2)
        max_offer_slots = max(0, max_offer_slots)

        if not candidate_offer_ids:
            if use_full_market:
                # Candidates filtered to MAX_CANDIDATE_RADIUS_KM from session origin
                # and sorted by price/LDM density — prioritizes high-yield nearby
                # offers over distant expensive ones.
                radius_m = self._settings.MAX_CANDIDATE_RADIUS_KM * 1000
                limit = self._settings.FULL_MARKET_CANDIDATE_LIMIT
                origin_point = func.ST_SetSRID(
                    func.ST_MakePoint(
                        float(session.origin_lon),
                        float(session.origin_lat),
                    ),
                    4326,
                )

                def _full_market_stmt(within_m: int) -> Select[tuple[MarketOffer]]:
                    return (
                        select(MarketOffer)
                        .where(
                            func.ST_DWithin(
                                cast(MarketOffer.pickup_point, Geography),
                                cast(origin_point, Geography),
                                within_m,
                            ),
                            MarketOffer.ldm > 0,
                        )
                        .order_by((MarketOffer.price_eur / MarketOffer.ldm).desc())
                        .limit(limit)
                    )

                result = await self._db.execute(_full_market_stmt(radius_m))
                rows = list(result.scalars().all())
                if len(rows) == 0:
                    _logger.info(
                        "No offers within %d km of origin, expanding to %d km",
                        self._settings.MAX_CANDIDATE_RADIUS_KM,
                        self._settings.MAX_CANDIDATE_RADIUS_KM * 2,
                    )
                    expanded = await self._db.execute(_full_market_stmt(radius_m * 2))
                    rows = list(expanded.scalars().all())

                candidate_offer_ids = [o.id for o in rows]
                if not candidate_offer_ids:
                    return await self._persist_empty_result(session_id, "INFEASIBLE", 0)
            else:
                ranked = await OfferScorerService(self._db, routing=self._routing).rank_offers(
                    session_id,
                    limit=max_offer_slots,
                )
                candidate_offer_ids = [o.offer_id for o in ranked.offers]
            if not candidate_offer_ids:
                return await self._persist_empty_result(session_id, "INFEASIBLE", 0)

        candidates = await self._fetch_offers(candidate_offer_ids)
        if not candidates:
            raise NotFoundError("No candidate offers found for provided IDs.")

        # Preserve request order where possible
        candidates_by_id = {o.id: o for o in candidates}
        candidates = [candidates_by_id[oid] for oid in candidate_offer_ids if oid in candidates_by_id]

        origin = (float(session.origin_lat), float(session.origin_lon))
        existing_waypoints: list[tuple[float, float]] = [origin]

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

        if self._settings.USE_SOLVER_MOCK:
            selected_idx, obj_cents, status_str, is_optimal, elapsed_ms = _solve_mock(
                candidates,
                free_ldm,
                free_weight_kg,
                max_offer_slots,
                net_cents,
                float(time_limit_seconds),
            )
        else:
            selected_idx, obj_cents, status_str, is_optimal, elapsed_ms = (
                await asyncio.to_thread(
                    _solve_cp_sat,
                    candidates,
                    free_ldm,
                    free_weight_kg,
                    max_offer_slots,
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

        current_offer_ids = await self._session_service._session_offer_ids(session_id)
        stop_sequence = await self._build_stop_sequence(session, selected_offers, origin)
        stop_sequence_json: list[dict[str, object]] | None = (
            [entry.model_dump(mode="json") for entry in stop_sequence] if stop_sequence else None
        )

        orm_result = SolverResult(
            session_id=session_id,
            selected_offer_ids=selected_ids,
            stop_sequence_json=stop_sequence_json,
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
            stop_sequence=stop_sequence,
            current_offer_ids=current_offer_ids,
        )

    async def get_status(
        self,
        session_id: UUID,
        *,
        redis: object | None = None,
    ) -> SolverStatusResponse:
        session = await self._load_session(session_id)
        if session is None:
            raise NotFoundError(f"Session {session_id} not found.")

        job = await SolverJobStore.get(redis, session_id)  # type: ignore[arg-type]
        if job is not None and job.status == "RUNNING":
            if job.cancel_requested:
                return SolverStatusResponse(
                    status="CANCELLED",
                    elapsed_ms=job.elapsed_ms(),
                    best_objective=job.best_objective,
                    result=None,
                )
            return SolverStatusResponse(
                status="RUNNING",
                elapsed_ms=job.elapsed_ms(),
                best_objective=job.best_objective,
                result=None,
            )

        orm_result = await self._load_latest_result(session_id)
        if orm_result is None:
            return SolverStatusResponse(status="IDLE", elapsed_ms=0)

        run_result = await self._orm_to_run_result(session_id, orm_result)
        terminal_status: SolverJobStatus = (orm_result.solver_status or "UNKNOWN")  # type: ignore[assignment]
        return SolverStatusResponse(
            status=terminal_status,
            elapsed_ms=orm_result.solve_time_ms or 0,
            best_objective=(
                float(orm_result.objective_value)
                if orm_result.objective_value is not None
                else None
            ),
            result=run_result,
        )

    async def cancel(self, session_id: UUID) -> SolverRunResult:
        session = await self._load_session(session_id)
        if session is None:
            raise NotFoundError(f"Session {session_id} not found.")

        stmt = (
            select(SolverResult)
            .where(SolverResult.session_id == session_id)
            .order_by(SolverResult.created_at.desc())
            .limit(1)
        )
        result = await self._db.execute(stmt)
        orm_result = result.scalars().first()

        if orm_result is None:
            orm_result = SolverResult(
                session_id=session_id,
                selected_offer_ids=[],
                solver_status="CANCELLED",
                objective_value=0.0,
                solve_time_ms=0,
            )
            self._db.add(orm_result)
        else:
            orm_result.solver_status = "CANCELLED"

        await self._db.flush()
        await self._db.refresh(orm_result)
        session.solver_run_id = orm_result.id
        await self._db.flush()

        return SolverRunResult(
            session_id=session_id,
            solver_run_id=orm_result.id,
            selected_offer_ids=[],
            objective_value=0.0,
            solver_status="CANCELLED",
            is_optimal=False,
            solve_time_ms=0,
            stop_sequence=[],
            current_offer_ids=await self._session_service._session_offer_ids(session_id),
        )

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    async def _load_session(self, session_id: UUID) -> ConsolidationSession | None:
        return await load_session(self._db, session_id)

    async def _build_stop_sequence(
        self,
        session: ConsolidationSession,
        selected_offers: list[MarketOffer],
        origin: tuple[float, float],
    ) -> list[StopSequenceEntry]:
        """Build an optimized stop sequence for selected offers (preview, no DB mutation)."""
        if not selected_offers:
            return []

        selected_ids = {offer.id for offer in selected_offers}
        existing_by_offer: dict[UUID, dict[str, RouteStop]] = {}
        for stop in session.route_stops:
            if stop.offer_id in selected_ids:
                existing_by_offer.setdefault(stop.offer_id, {})[stop.stop_type] = stop

        stops: list[Stop] = []
        route_stop_ids: dict[str, UUID] = {}
        for offer in selected_offers:
            pair = existing_by_offer.get(offer.id)
            handling = offer.handling_time_minutes or 30
            for stop_type, location_geom in (
                ("pickup", offer.pickup_point),
                ("delivery", offer.delivery_point),
            ):
                existing = pair.get(stop_type) if pair else None
                stop_id = existing.id if existing is not None else uuid4()
                route_stop_ids[str(stop_id)] = stop_id
                stops.append(
                    Stop(
                        id=str(stop_id),
                        offer_id=offer.id,
                        stop_type=stop_type,  # type: ignore[arg-type]
                        location=lat_lon_from_geometry(location_geom),
                        handling_time_minutes=handling,
                    ),
                )

        waypoints = [origin] + [stop.location for stop in stops]
        matrix = await self._routing.get_distance_matrix(waypoints)
        node_indices = build_node_indices(stops)
        ordered = optimize_stop_sequence(stops, matrix=matrix, node_indices=node_indices)

        return [
            StopSequenceEntry(
                route_stop_id=route_stop_ids[stop.id],
                offer_id=stop.offer_id,
                stop_type=stop.stop_type,
                sequence_order=index,
            )
            for index, stop in enumerate(ordered)
        ]

    async def _load_latest_result(self, session_id: UUID) -> SolverResult | None:
        stmt = (
            select(SolverResult)
            .where(SolverResult.session_id == session_id)
            .order_by(SolverResult.created_at.desc())
            .limit(1)
        )
        result = await self._db.execute(stmt)
        return result.scalars().first()

    async def _orm_to_run_result(
        self,
        session_id: UUID,
        orm_result: SolverResult,
    ) -> SolverRunResult:
        stop_sequence: list[StopSequenceEntry] = []
        raw_sequence = orm_result.stop_sequence_json
        if isinstance(raw_sequence, list):
            stop_sequence = [StopSequenceEntry.model_validate(entry) for entry in raw_sequence]

        status: SolverRunStatus = (orm_result.solver_status or "UNKNOWN")  # type: ignore[assignment]
        return SolverRunResult(
            session_id=session_id,
            solver_run_id=orm_result.id,
            selected_offer_ids=list(orm_result.selected_offer_ids or []),
            objective_value=float(orm_result.objective_value or 0.0),
            solver_status=status,
            is_optimal=status == "OPTIMAL",
            solve_time_ms=orm_result.solve_time_ms or 0,
            stop_sequence=stop_sequence,
            current_offer_ids=await self._session_service._session_offer_ids(session_id),
        )

    async def _fetch_offers(self, offer_ids: list[UUID]) -> list[MarketOffer]:
        stmt = (
            select(MarketOffer)
            .where(MarketOffer.id.in_(offer_ids))
        )
        result = await self._db.execute(stmt)
        return list(result.scalars().all())

    async def _persist_empty_result(
        self,
        session_id: UUID,
        status: SolverRunStatus,
        solve_time_ms: int,
    ) -> SolverRunResult:
        session = await self._load_session(session_id)
        if session is None:
            raise NotFoundError(f"Session {session_id} not found.")

        orm_result = SolverResult(
            session_id=session_id,
            selected_offer_ids=[],
            solver_status=status,
            objective_value=0.0,
            solve_time_ms=solve_time_ms,
        )
        self._db.add(orm_result)
        await self._db.flush()
        await self._db.refresh(orm_result)
        session.solver_run_id = orm_result.id
        await self._db.flush()

        return SolverRunResult(
            session_id=session_id,
            solver_run_id=orm_result.id,
            selected_offer_ids=[],
            objective_value=0.0,
            solver_status=status,
            is_optimal=False,
            solve_time_ms=solve_time_ms,
            current_offer_ids=await self._session_service._session_offer_ids(session_id),
        )
