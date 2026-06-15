from __future__ import annotations

from typing import Any

from fastapi import status


class AppException(Exception):
    """Base class for all expected, user-facing application errors."""

    status_code: int = status.HTTP_500_INTERNAL_SERVER_ERROR
    error_code: str = "internal_error"
    default_detail: str = "Unexpected error."

    def __init__(
        self,
        detail: str | None = None,
        *,
        status_code: int | None = None,
        error_code: str | None = None,
        context: dict[str, Any] | None = None,
    ) -> None:
        self.detail = detail or self.default_detail
        if status_code is not None:
            self.status_code = status_code
        if error_code is not None:
            self.error_code = error_code
        self.context: dict[str, Any] = context or {}
        super().__init__(self.detail)


class NotFoundError(AppException):
    status_code = status.HTTP_404_NOT_FOUND
    error_code = "not_found"
    default_detail = "Resource not found."


class ValidationAppError(AppException):
    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    error_code = "validation_error"
    default_detail = "Validation failed."


class ConflictError(AppException):
    status_code = status.HTTP_409_CONFLICT
    error_code = "conflict"
    default_detail = "State conflict."


class ExternalServiceError(AppException):
    status_code = status.HTTP_502_BAD_GATEWAY
    error_code = "external_service_error"
    default_detail = "Upstream service failed."


class RoutingUnavailableError(ExternalServiceError):
    """Raised when the routing provider is unreachable or returns an error response."""

    error_code = "routing_unavailable"
    default_detail = "Routing service is unavailable."

    def __init__(self, message: str = "Routing service is unavailable") -> None:
        super().__init__(detail=message)
        self.message = message
