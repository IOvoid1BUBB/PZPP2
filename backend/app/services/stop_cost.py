"""Per-stop cost estimation for route planning."""

from __future__ import annotations

from app.core.config import Settings, get_settings


class StopCostCalculator:
    """Estimate handling cost at a single route stop."""

    _WORKING_HOURS_PER_DAY = 10.0

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()

    def calculate(self, handling_time_minutes: int | None = None) -> float:
        """Return stop cost in EUR based on driver time at the stop."""
        minutes = handling_time_minutes or self._settings.STOP_COST_MINUTES
        hourly_rate = self._settings.DRIVER_DAILY_ALLOWANCE_EUR / self._WORKING_HOURS_PER_DAY
        return round((minutes / 60.0) * hourly_rate, 4)
