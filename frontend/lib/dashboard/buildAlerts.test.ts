import { describe, expect, it } from "vitest";

import { buildAlerts } from "@/lib/dashboard/buildAlerts";
import type {
  DashboardKpi,
  DashboardSessionSummary,
} from "@/lib/api/dashboardClient";
import type { RankedOfferRow } from "@/lib/types/offers";

const NOW = new Date("2026-06-15T12:00:00Z").getTime();

function kpi(overrides: Partial<DashboardKpi> = {}): DashboardKpi {
  return {
    active_sessions: 0,
    total_sessions: 0,
    total_estimated_profit_eur: 0,
    average_fill_pct: 0,
    market_offers_count: 0,
    ...overrides,
  };
}

function session(
  overrides: Partial<DashboardSessionSummary> = {},
): DashboardSessionSummary {
  return {
    id: "11112222-3333-4444-5555-666677778888",
    status: "draft",
    created_at: new Date(NOW).toISOString(),
    vehicle_name: "Renault Master L2",
    stop_count: 0,
    offer_count: 0,
    estimated_net_profit_eur: null,
    ...overrides,
  };
}

describe("buildAlerts", () => {
  it("returns an empty-state alert when nothing notable is present", () => {
    const alerts = buildAlerts({ sessions: [], kpis: kpi(), now: NOW });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].id).toBe("empty-state");
  });

  it("flags compliance violations as a warning", () => {
    const alerts = buildAlerts({
      sessions: [],
      kpis: kpi(),
      complianceViolations: 2,
      now: NOW,
    });
    const compliance = alerts.find((a) => a.id === "compliance");
    expect(compliance).toBeDefined();
    expect(compliance?.type).toBe("warning");
    expect(compliance?.body).toContain("2");
  });

  it("creates a free-space info alert for draft sessions without offers", () => {
    const alerts = buildAlerts({
      sessions: [session({ offer_count: 0, status: "draft" })],
      kpis: kpi(),
      now: NOW,
    });
    const free = alerts.find((a) => a.id.startsWith("empty-1111"));
    expect(free).toBeDefined();
    expect(free?.type).toBe("info");
    expect(free?.href).toBe("/planner");
  });

  it("flags stale drafts older than 24h", () => {
    const old = new Date(NOW - 48 * 60 * 60 * 1000).toISOString();
    const alerts = buildAlerts({
      sessions: [session({ created_at: old, offer_count: 2, status: "draft" })],
      kpis: kpi(),
      now: NOW,
    });
    expect(alerts.some((a) => a.id.startsWith("stale-"))).toBe(true);
  });

  it("surfaces hot ranked offers above the threshold", () => {
    const offers: RankedOfferRow[] = [
      {
        offer_id: "offer-hot",
        total_score: 2.6,
        revenue_density_score: 0,
        detour_penalty_score: 0,
        fill_contribution_score: 0,
        time_window_score: 0,
        added_km: 0,
        estimated_added_cost_eur: 0,
        price_eur: 420,
        ldm: 2,
        delivery_label: "Monachium",
      },
      {
        offer_id: "offer-cold",
        total_score: 0.5,
        revenue_density_score: 0,
        detour_penalty_score: 0,
        fill_contribution_score: 0,
        time_window_score: 0,
        added_km: 0,
        estimated_added_cost_eur: 0,
      },
    ];
    const alerts = buildAlerts({
      sessions: [],
      kpis: kpi(),
      rankedOffers: offers,
      hotOfferScoreThreshold: 2.0,
      now: NOW,
    });
    const hot = alerts.filter((a) => a.id.startsWith("hot-"));
    expect(hot).toHaveLength(1);
    expect(hot[0].href).toContain("offer-hot");
    expect(hot[0].body).toContain("210.00 EUR/LDM");
  });
});
