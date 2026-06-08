"""Persist reverse-geocoded labels on :class:`RouteStop` rows."""

from __future__ import annotations

from uuid import UUID

from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_sessionmaker
from app.lib.geo import lat_lon_from_geometry
from app.lib.geocoder import reverse_geocode
from app.lib.redis_client import get_redis
from app.models import RouteStop


async def ensure_stop_label(
    db: AsyncSession,
    stop: RouteStop,
    *,
    redis: Redis,
) -> str:
    """Return persisted label, geocoding and saving when ``address_label`` is NULL."""
    if stop.address_label:
        return stop.address_label

    lat, lon = lat_lon_from_geometry(stop.location)
    label = await reverse_geocode(lat, lon, redis=redis)
    stop.address_label = label
    await db.flush()
    return label


async def resolve_and_persist_stop_label(stop_id: UUID) -> None:
    """Background task: geocode one stop using a fresh DB session."""
    sessionmaker = get_sessionmaker()
    redis = get_redis()
    async with sessionmaker() as db:
        result = await db.execute(select(RouteStop).where(RouteStop.id == stop_id))
        stop = result.scalar_one_or_none()
        if stop is None or stop.address_label is not None:
            return
        lat, lon = lat_lon_from_geometry(stop.location)
        label = await reverse_geocode(lat, lon, redis=redis)
        stop.address_label = label
        await db.commit()
