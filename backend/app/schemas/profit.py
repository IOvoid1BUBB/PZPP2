"""Pydantic schemas for the session profit breakdown endpoint."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class SessionProfitBreakdown(BaseModel):
    """Full 5-category cost breakdown with derived profitability metrics."""

    model_config = ConfigDict(extra="forbid")

    revenue_eur: float
    fuel_eur: float
    toll_eur: float
    stop_costs_eur: float
    driver_eur: float
    maintenance_eur: float
    total_cost_eur: float
    net_profit_eur: float
    profit_margin_pct: float
    cost_per_km_eur: float
    revenue_per_ldm_eur: float
    breakeven_fill_pct: float | None
