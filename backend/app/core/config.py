"""Application settings sourced from environment variables / `.env`.

Uses Pydantic v2 (`pydantic-settings`). Settings are loaded once via
:func:`get_settings`, cached with :func:`functools.lru_cache`, and consumed
through FastAPI's dependency injection (see :func:`app.core.dependencies`).
"""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Strongly-typed application settings.

    Field names map 1:1 to env vars (case-insensitive).
    """

    APP_NAME: str = "LoadMax API"
    APP_VERSION: str = "1.0.0"
    LOG_LEVEL: str = "INFO"
    ALLOWED_ORIGINS: list[str] = ["*"]

    DATABASE_URL: str
    ORS_API_KEY: str = ""
    ORS_BASE_URL: str = "https://api.openrouteservice.org"
    ORS_PROFILE: str = "driving-hgv"
    REDIS_URL: str = "redis://redis:6379/0"
    NOMINATIM_USER_AGENT: str = "LoadMax/1.0 (contact@example.com)"

    FUEL_PRICE_EUR_PER_LITER: float = 1.75
    DRIVER_DAILY_ALLOWANCE_EUR: float = 49.0
    STOP_COST_MINUTES: int = 30
    WEIGHT_FUEL_FACTOR: float = 0.30
    MAINTENANCE_EUR_PER_KM: float = 0.08
    MAX_STOPS_PER_ROUTE: int = 12
    USE_SOLVER_MOCK: bool = False
    USE_ROUTING_MOCK: bool = False

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return a process-wide singleton :class:`Settings` instance."""
    return Settings()
