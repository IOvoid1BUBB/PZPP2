"""Unit tests for the route_stops address_label backfill script."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
import respx
from geoalchemy2.shape import from_shape
from shapely.geometry import Point

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://loadmax:loadmax@localhost:5432/loadmax",
)

from app.lib.geocoder import NOMINATIM_REVERSE_URL, reset_rate_limit_state
from app.models import RouteStop

BACKEND_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = BACKEND_ROOT / "scripts"

if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import backfill_address_labels as backfill  # noqa: E402

NOMINATIM_RESPONSE: dict[str, Any] = {
    "address": {
        "city": "Warszawa",
        "road": "Marszałkowska",
        "country": "Polska",
    },
}


@pytest.fixture(autouse=True)
def _reset_rate_limit() -> None:
    reset_rate_limit_state()


def _location(lat: float = 52.2297, lon: float = 21.0122) -> Any:
    return from_shape(Point(lon, lat), srid=4326)


def _make_stop(*, address_label: str | None = None) -> RouteStop:
    stop = RouteStop(
        stop_type="pickup",
        sequence_order=0,
        location=_location(),
    )
    stop.address_label = address_label
    return stop


def test_missing_label_condition_matches_null_and_empty() -> None:
    compiled = str(
        backfill.missing_label_condition().compile(compile_kwargs={"literal_binds": True}),
    ).lower()
    assert "address_label is null" in compiled
    assert "address_label = ''" in compiled


@pytest.mark.asyncio
async def test_process_batch_writes_labels_for_missing_stops() -> None:
    stops = [_make_stop(address_label=None), _make_stop(address_label="")]
    db = AsyncMock()
    redis = AsyncMock()

    with patch.object(backfill, "ensure_stop_label", new_callable=AsyncMock) as mock_ensure:
        mock_ensure.side_effect = lambda _db, stop, *, redis: (
            setattr(stop, "address_label", "Warszawa, Marszałkowska")
            or "Warszawa, Marszałkowska"
        )

        updated = await backfill.process_batch(db, stops, redis=redis)

    assert updated == 2
    assert mock_ensure.await_count == 2
    assert stops[0].address_label == "Warszawa, Marszałkowska"
    assert stops[1].address_label == "Warszawa, Marszałkowska"


@pytest.mark.asyncio
async def test_process_batch_does_not_count_prelabeled_stops() -> None:
    stop = _make_stop(address_label="Kraków, Floriańska")
    db = AsyncMock()
    redis = AsyncMock()

    with patch.object(backfill, "ensure_stop_label", new_callable=AsyncMock) as mock_ensure:
        mock_ensure.return_value = "Kraków, Floriańska"
        updated = await backfill.process_batch(db, [stop], redis=redis)

    assert updated == 0
    mock_ensure.assert_awaited_once()


@pytest.mark.asyncio
@respx.mock
async def test_process_batch_nominatim_failure_uses_coordinate_fallback() -> None:
    respx.get(NOMINATIM_REVERSE_URL).mock(side_effect=httpx.TimeoutException("timeout"))
    stop = _make_stop(address_label=None)
    db = AsyncMock()
    db.flush = AsyncMock()
    redis = AsyncMock(spec=["get", "setex"])
    redis.get = AsyncMock(return_value=None)
    redis.setex = AsyncMock()

    updated = await backfill.process_batch(db, [stop], redis=redis)

    assert updated == 1
    assert stop.address_label == "52.2297, 21.0122"


@pytest.mark.asyncio
@respx.mock
async def test_process_batch_nominatim_success_persists_city_road_label() -> None:
    respx.get(NOMINATIM_REVERSE_URL).mock(
        return_value=httpx.Response(200, json=NOMINATIM_RESPONSE),
    )
    stop = _make_stop(address_label=None)
    db = AsyncMock()
    db.flush = AsyncMock()
    redis = AsyncMock(spec=["get", "setex"])
    redis.get = AsyncMock(return_value=None)
    redis.setex = AsyncMock()

    updated = await backfill.process_batch(db, [stop], redis=redis)

    assert updated == 1
    assert stop.address_label == "Warszawa, Marszałkowska"


@pytest.mark.asyncio
async def test_backfill_processes_multiple_batches_and_commits() -> None:
    batch_one = [_make_stop(address_label=None), _make_stop(address_label=None)]
    batch_two = [_make_stop(address_label="")]
    fetch_calls = 0

    async def _fetch(_db: AsyncMock, *, batch_size: int) -> list[RouteStop]:
        nonlocal fetch_calls
        fetch_calls += 1
        if fetch_calls == 1:
            return batch_one
        if fetch_calls == 2:
            return batch_two
        return []

    mock_db = AsyncMock()
    mock_db.commit = AsyncMock()
    mock_context = AsyncMock()
    mock_context.__aenter__ = AsyncMock(return_value=mock_db)
    mock_context.__aexit__ = AsyncMock(return_value=None)
    session_factory = MagicMock(return_value=mock_context)

    with (
        patch.object(backfill, "fetch_stops_missing_label", side_effect=_fetch),
        patch.object(
            backfill,
            "process_batch",
            new_callable=AsyncMock,
            side_effect=[2, 1],
        ),
        patch.object(backfill, "count_stops_missing_label", new_callable=AsyncMock, return_value=0),
    ):
        stats = await backfill.backfill_address_labels(
            batch_size=50,
            session_factory=session_factory,
            redis=AsyncMock(),
        )

    assert stats.batches == 2
    assert stats.processed == 3
    assert stats.updated == 3
    assert stats.remaining == 0
    assert mock_db.commit.await_count == 2


@pytest.mark.asyncio
async def test_backfill_is_idempotent_when_no_missing_labels() -> None:
    mock_db = AsyncMock()
    mock_context = AsyncMock()
    mock_context.__aenter__ = AsyncMock(return_value=mock_db)
    mock_context.__aexit__ = AsyncMock(return_value=None)
    session_factory = MagicMock(return_value=mock_context)

    with (
        patch.object(
            backfill,
            "fetch_stops_missing_label",
            new_callable=AsyncMock,
            return_value=[],
        ),
        patch.object(backfill, "count_stops_missing_label", new_callable=AsyncMock, return_value=0),
        patch.object(backfill, "process_batch", new_callable=AsyncMock) as mock_process,
    ):
        stats = await backfill.backfill_address_labels(
            session_factory=session_factory,
            redis=AsyncMock(),
        )

    assert stats.batches == 0
    assert stats.processed == 0
    assert stats.updated == 0
    mock_process.assert_not_awaited()
    mock_db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_backfill_second_run_skips_already_labeled_rows() -> None:
    labeled_stop = _make_stop(address_label="Warszawa, Marszałkowska")
    mock_db = AsyncMock()
    mock_db.commit = AsyncMock()
    mock_context = AsyncMock()
    mock_context.__aenter__ = AsyncMock(return_value=mock_db)
    mock_context.__aexit__ = AsyncMock(return_value=None)
    session_factory = MagicMock(return_value=mock_context)

    with (
        patch.object(
            backfill,
            "fetch_stops_missing_label",
            new_callable=AsyncMock,
            return_value=[],
        ),
        patch.object(backfill, "count_stops_missing_label", new_callable=AsyncMock, return_value=0),
        patch.object(backfill, "process_batch", new_callable=AsyncMock) as mock_process,
    ):
        stats = await backfill.backfill_address_labels(
            session_factory=session_factory,
            redis=AsyncMock(),
        )

    assert stats.processed == 0
    mock_process.assert_not_awaited()
    assert labeled_stop.address_label == "Warszawa, Marszałkowska"


@pytest.mark.asyncio
async def test_main_runs_backfill_and_prints_summary(capsys: pytest.CaptureFixture[str]) -> None:
    expected = backfill.BackfillStats(batches=1, processed=2, updated=2, remaining=0)

    with (
        patch.object(backfill, "_ensure_env"),
        patch.object(backfill, "get_settings"),
        patch.object(
            backfill,
            "backfill_address_labels",
            new_callable=AsyncMock,
            return_value=expected,
        ),
    ):
        await backfill.main()

    captured = capsys.readouterr()
    assert "batches=1" in captured.out
    assert "updated=2" in captured.out
    assert "remaining=0" in captured.out


@pytest.mark.asyncio
async def test_main_exits_on_failure() -> None:
    with (
        patch.object(backfill, "_ensure_env"),
        patch.object(backfill, "get_settings"),
        patch.object(
            backfill,
            "backfill_address_labels",
            new_callable=AsyncMock,
            side_effect=RuntimeError("db down"),
        ),
        pytest.raises(SystemExit) as exc_info,
    ):
        await backfill.main()

    assert exc_info.value.code == 1
