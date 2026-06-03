"""Pydantic schemas for the session profit breakdown endpoint."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class CostFormulaMeta(BaseModel):
    """Inputs displayed in frontend tooltips — no derived business logic on FE."""

    model_config = ConfigDict(extra="forbid")

    liters_total: float | None = None
    fuel_price: float | None = None
    distance_km: float | None = None
    stop_count: int | None = None
    per_stop_cost: float | None = None
    days_on_road: int | None = None
    daily_allowance: float | None = None
    maint_rate: float | None = None


class ProfitFormulas(BaseModel):
    """Formula metadata for each cost category shown in the waterfall tooltip."""

    model_config = ConfigDict(extra="forbid")

    fuel: CostFormulaMeta
    toll: CostFormulaMeta
    stops: CostFormulaMeta
    driver: CostFormulaMeta
    maintenance: CostFormulaMeta


class LegFuelBreakdown(BaseModel):
    """Per-leg fuel consumption for the analytics per-leg bar chart."""

    model_config = ConfigDict(extra="forbid")

    leg_id: int = Field(..., ge=1, description="1-based leg index for chart axis")
    fuel_consumption: float = Field(..., ge=0, description="Liters consumed on leg")


class OfferRevenueRow(BaseModel):
    """Revenue attributed to a unique pickup offer (for client pie chart)."""

    model_config = ConfigDict(extra="forbid")

    offer_id: UUID
    revenue_eur: float = Field(..., ge=0)


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
    stop_count: int = Field(..., ge=0)
    formulas: ProfitFormulas
    legs: list[LegFuelBreakdown]
    offer_revenue: list[OfferRevenueRow]
