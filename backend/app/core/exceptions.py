"""Domain-level exception hierarchy.

All exceptions inherit from :class:`AppException` which is rendered by the
global handler in :mod:`app.main` into the unified error envelope::

    {"error": <code>, "detail": <message>, "request_id": <uuid>}
"""

from __future__ import annotations

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
    ) -> None:
        self.detail = detail or self.default_detail
        if status_code is not None:
            self.status_code = status_code
        if error_code is not None:
            self.error_code = error_code
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
