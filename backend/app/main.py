"""FastAPI application entry point.

Wires together:

1. **Logging** – structured JSON via :func:`app.core.logging.configure_logging`.
2. **Middleware** – registration order:

   1. CORS                         (outermost; handles preflights & headers)
   2. RequestIDMiddleware          (assigns / propagates ``X-Request-ID``)
   3. AccessLogMiddleware          (logs one JSON line per request)

3. **Exception handlers** – :class:`AppException` → unified JSON envelope.
4. **Routers** – ``/health`` + ``/api/v1/*``.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import build_api_router
from app.core.config import Settings, get_settings
from app.core.exceptions import AppException
from app.core.logging import configure_logging
from app.core.middleware import AccessLogMiddleware, RequestIDMiddleware
from app.lib.osrm import shutdown_osrm_client
from app.lib.redis_client import shutdown_redis
from app.schemas.common import HealthResponse

_logger = logging.getLogger("app")


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Initialize on startup, release external clients on shutdown."""
    settings = get_settings()
    configure_logging(settings.LOG_LEVEL)
    _logger.info("application_startup", extra={"app": settings.APP_NAME})
    try:
        yield
    finally:
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
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": exc.error_code,
                "detail": exc.detail,
                "request_id": request_id,
            },
        )

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
