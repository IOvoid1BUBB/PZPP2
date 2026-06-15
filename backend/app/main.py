"""FastAPI application entry point."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime

import httpx
from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.api import build_api_router
from app.core.config import Settings, get_settings
from app.core.database import get_engine, get_sessionmaker
from app.core.exceptions import AppException
from app.core.logging import configure_logging
from app.core.middleware import AccessLogMiddleware, RequestIDMiddleware
from app.lib.osrm import shutdown_osrm_client
from app.lib.redis_client import get_redis, shutdown_redis
from app.schemas.common import DependencyStatus, HealthResponse, ReadinessResponse
from app.services.market_offers import bulk_insert_offers
from app.services.market_simulator import generate_batch

_logger = logging.getLogger("app")


_OFFER_REFRESH_INTERVAL_SECONDS = 5 * 60  # co 5 minut
_OFFER_REFRESH_BATCH = 50               # ile nowych ofert na refresh


async def _offer_refresh_loop() -> None:
    """Tle generuje nowe oferty co _OFFER_REFRESH_INTERVAL_SECONDS.

    Tworzy własną sesję DB — niezależną od request lifecycle.
    Błędy są logowane i nie zatrzymują pętli.
    """
    await asyncio.sleep(30)  # krótkie opóźnienie po starcie
    session_factory = get_sessionmaker()
    while True:
        try:
            generated = generate_batch(_OFFER_REFRESH_BATCH, base_time=datetime.now(UTC))
            async with session_factory() as session:
                inserted, skipped = await bulk_insert_offers(session, [g.offer for g in generated])
                await session.commit()
            _logger.info(
                "offer_refresh: inserted=%d skipped=%d",
                inserted,
                skipped,
                extra={"event": "offers:refresh"},
            )
        except Exception as exc:
            _logger.warning("offer_refresh failed: %s", exc, extra={"event": "offers:refresh:error"})
        await asyncio.sleep(_OFFER_REFRESH_INTERVAL_SECONDS)


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Initialize on startup, release external clients on shutdown."""
    settings = get_settings()
    configure_logging(settings.LOG_LEVEL)
    from app.services.toll_calculator import load_country_geometries

    load_country_geometries()
    _logger.info("application_startup", extra={"app": settings.APP_NAME})

    # Uruchom pętlę odświeżania ofert w tle
    refresh_task = asyncio.create_task(_offer_refresh_loop())

    try:
        yield
    finally:
        refresh_task.cancel()
        import contextlib
        async with contextlib.AsyncExitStack():
            with contextlib.suppress(asyncio.CancelledError):
                await refresh_task
        await shutdown_osrm_client()
        await shutdown_redis()
        _logger.info("application_shutdown")
    _ = app  # silence unused-arg warnings


def _register_middleware(app: FastAPI, settings: Settings) -> None:
    """Register middlewares in the order documented in the module docstring.

    Note: Starlette runs middlewares in the **reverse** of registration order
    for the request phase. Registering CORS first means it ends up as the
    outermost layer — exactly what we want.
    """
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-ID"],
    )
    app.add_middleware(RequestIDMiddleware)
    app.add_middleware(AccessLogMiddleware)


def _register_exception_handlers(app: FastAPI) -> None:
    """Install the unified error-envelope handlers."""

    @app.exception_handler(AppException)
    async def app_exception_handler(request: Request, exc: AppException) -> JSONResponse:
        request_id = getattr(request.state, "request_id", "")
        content: dict[str, object] = {
            "error": exc.error_code,
            "detail": exc.detail,
            "request_id": request_id,
        }
        content.update(exc.context)
        return JSONResponse(status_code=exc.status_code, content=content)

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(
        request: Request,
        exc: RequestValidationError,
    ) -> JSONResponse:
        request_id = getattr(request.state, "request_id", "")
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={
                "error": "validation_error",
                "detail": exc.errors(),
                "request_id": request_id,
            },
        )


def _register_routes(app: FastAPI, settings: Settings) -> None:
    """Mount /health and the /api/v1 aggregate router."""

    @app.get(
        "/health",
        response_model=HealthResponse,
        tags=["health"],
        summary="Liveness probe",
    )
    async def health(request: Request) -> HealthResponse:
        return HealthResponse(
            status="ok",
            version=settings.APP_VERSION,
            request_id=getattr(request.state, "request_id", ""),
        )

    @app.get(
        "/health/ready",
        response_model=ReadinessResponse,
        tags=["health"],
        summary="Readiness probe (database, Redis, OSRM)",
    )
    async def readiness(request: Request) -> ReadinessResponse:
        checks: list[DependencyStatus] = []

        try:
            async with get_engine().connect() as conn:
                await conn.execute(text("SELECT 1"))
            checks.append(DependencyStatus(name="database", ok=True))
        except Exception as exc:  # noqa: BLE001 — surface dependency state
            checks.append(DependencyStatus(name="database", ok=False, detail=str(exc)))

        try:
            redis = get_redis()
            pong = await redis.ping()
            checks.append(
                DependencyStatus(
                    name="redis",
                    ok=bool(pong),
                    detail=None if pong else "ping failed",
                ),
            )
        except Exception as exc:  # noqa: BLE001
            checks.append(DependencyStatus(name="redis", ok=False, detail=str(exc)))

        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                # Punkt testowy: Warszawa → Łódź (pokryte przez poland-latest PBF)
                response = await client.get(
                    f"{settings.OSRM_HOST.rstrip('/')}"
                    f"/route/v1/{settings.OSRM_PROFILE}/21.01,52.22;19.46,51.75",
                    params={"overview": "false"},
                )
            osrm_ok = response.status_code == 200
            checks.append(
                DependencyStatus(
                    name="osrm",
                    ok=osrm_ok,
                    detail=(
                        None if osrm_ok
                        else f"HTTP {response.status_code} (profil: {settings.OSRM_PROFILE})"
                    ),
                ),
            )
        except Exception as exc:  # noqa: BLE001
            checks.append(DependencyStatus(name="osrm", ok=False, detail=str(exc)))

        required_ok = all(check.ok for check in checks if check.name in {"database", "redis"})
        return ReadinessResponse(
            status="ok" if required_ok else "degraded",
            version=settings.APP_VERSION,
            request_id=getattr(request.state, "request_id", ""),
            checks=checks,
        )

    app.include_router(build_api_router())


def create_app() -> FastAPI:
    """Application factory. Importable as ``app.main:app`` for uvicorn."""
    settings = get_settings()
    configure_logging(settings.LOG_LEVEL)
    app = FastAPI(
        title=settings.APP_NAME,
        version=settings.APP_VERSION,
        lifespan=_lifespan,
    )
    _register_middleware(app, settings)
    _register_exception_handlers(app)
    _register_routes(app, settings)
    return app


app = create_app()
