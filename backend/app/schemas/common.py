"""Shared response schemas used across multiple routers."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class ErrorResponse(BaseModel):
    """Unified error envelope returned by the global exception handler."""

    model_config = ConfigDict(extra="forbid")

    error: str = Field(..., description="Stable machine-readable error code.")
    detail: str = Field(..., description="Human-readable error message.")
    request_id: str = Field(..., description="Per-request correlation id (X-Request-ID).")


class HealthResponse(BaseModel):
    """Lightweight liveness payload (no upstream checks)."""

    model_config = ConfigDict(extra="forbid")

    status: str = Field(..., description="Service status, currently always 'ok'.")
    version: str = Field(..., description="Application semantic version.")
    request_id: str = Field(..., description="Per-request correlation id.")
