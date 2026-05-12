import os
from collections.abc import AsyncGenerator

import httpx
from fastapi import Depends, FastAPI
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

DATABASE_URL = os.environ["DATABASE_URL"]

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)

ORS_HEALTH_URL = "https://api.openrouteservice.org/v2/health"
# Chmura ORS często nie serwuje /v2/health (404); wtedy weryfikujemy klucz minimalnym POST directions.
ORS_DIRECTIONS_URL = "https://api.openrouteservice.org/v2/directions/driving-car"


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session


async def check_ors() -> bool:
    api_key = os.environ.get("ORS_API_KEY", "").strip()
    if not api_key:
        return False
    headers = {"Authorization": api_key}
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(ORS_HEALTH_URL, headers=headers)
            if response.status_code == 200:
                return True
            if response.status_code == 404:
                r2 = await client.post(
                    ORS_DIRECTIONS_URL,
                    headers={**headers, "Content-Type": "application/json"},
                    json={
                        "coordinates": [
                            [8.681495, 49.41461],
                            [8.686507, 49.41943],
                        ]
                    },
                )
                return r2.status_code == 200
            return False
    except (httpx.HTTPError, OSError):
        return False


app = FastAPI(title="LoadMax API", version="1.0.0")


@app.get("/health")
async def health(db: AsyncSession = Depends(get_db)):
    await db.execute(text("SELECT 1"))
    ors_ok = await check_ors()
    return {
        "status": "ok",
        "db": True,
        "ors": ors_ok,
        "version": "1.0.0",
    }
