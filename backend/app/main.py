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


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session


async def check_osrm() -> bool:
    base = os.environ.get("OSRM_HOST", "http://osrm:5000").rstrip("/")
    # Short in-Poland sanity route; avoids failing when graph is empty far from PL.
    url = f"{base}/route/v1/driving/21.01,52.22;21.02,52.23"
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            response = await client.get(url)
            return response.status_code == 200
    except (httpx.HTTPError, OSError):
        return False


app = FastAPI(title="LoadMax API", version="1.0.0")


@app.get("/health")
async def health(db: AsyncSession = Depends(get_db)):
    await db.execute(text("SELECT 1"))
    osrm_ok = await check_osrm()
    return {
        "status": "ok",
        "db": True,
        "osrm": osrm_ok,
        "version": "1.0.0",
    }
