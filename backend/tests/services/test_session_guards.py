"""Unit tests for session draft guard and solver origin validation."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from app.core.exceptions import AppException
from app.services.sessions import SessionService


def test_ensure_draft_blocks_optimizing_status() -> None:
    session = MagicMock(status="optimizing")
    with pytest.raises(AppException) as exc_info:
        SessionService._ensure_draft(session)
    assert exc_info.value.status_code == 409
    assert exc_info.value.error_code == "session_not_draft"


def test_ensure_draft_allows_draft_status() -> None:
    session = MagicMock(status="draft")
    SessionService._ensure_draft(session)
