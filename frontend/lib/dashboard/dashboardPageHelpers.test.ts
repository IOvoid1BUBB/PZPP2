import { describe, expect, it } from "vitest";

import type { ActiveSessionSummary, DashboardResponse } from "@/lib/api/dashboardClient";
import {
  buildDispatchedMapSessions,
  buildKpiTiles,
  buildOperationalMapSessions,
  findActiveSession,
  plannerSessionHref,
} from "@/lib/dashboard/dashboardPageHelpers";

const dashboardFixture: DashboardResponse = {
  today_net_profit_eur: 100,
  today_net_profit_pln: 432,
  avg_lfill_pct: 67.4,
  empty_runs_pct: 12.5,
  active_sessions: [
    {
      session_id: "11111111-1111-4111-8111-111111110001",
      vehicle_name: "Renault Master L2",
      current_location: "52.2200°N, 21.0100°E",
      destination: "Berlin",
      lfil_pct: 80,
      status: "dispatched",
      has_time_window_risk: false,
    },
    {
      session_id: "22222222-2222-4222-8222-222222220002",
      vehicle_name: "MAN Solówka",
      current_location: "50.0000°N, 19.0000°E",
      destination: "Kraków",
      lfil_pct: 55,
      status: "confirmed",
      has_time_window_risk: true,
    },
    {
      session_id: "33333333-3333-4333-8333-333333330003",
      vehicle_name: "Renault Master L4",
      current_location: "51.0000°N, 20.0000°E",
      destination: "Gdańsk",
      lfil_pct: 10,
      status: "draft",
      has_time_window_risk: false,
    },
  ],
  notifications: [],
};

describe("buildKpiTiles", () => {
  it("formats PLN profit, LFILL and empty runs from API payload", () => {
    const tiles = buildKpiTiles(dashboardFixture);
    expect(tiles).toHaveLength(3);
    expect(tiles[0].value).toBe("432 PLN");
    expect(tiles[0].label).toBe("Dzienny zysk netto");
    expect(tiles[1].value).toBe("67%");
    expect(tiles[2].value).toBe("13%");
  });
});

describe("plannerSessionHref", () => {
  it("builds planner deep link with session query param", () => {
    expect(plannerSessionHref("abc-123")).toBe("/planner?session=abc-123");
  });
});

describe("buildOperationalMapSessions", () => {
  it("includes optimizing, confirmed and dispatched sessions", () => {
    const sessions = buildOperationalMapSessions(dashboardFixture.active_sessions);
    expect(sessions).toHaveLength(2);
    expect(sessions.map((s) => s.vehicleName)).toEqual([
      "Renault Master L2",
      "MAN Solówka",
    ]);
  });

  it("excludes draft sessions from the map", () => {
    const sessions = buildOperationalMapSessions(dashboardFixture.active_sessions);
    expect(sessions.every((session) => session.status !== "draft")).toBe(true);
  });
});

describe("buildDispatchedMapSessions", () => {
  it("returns only dispatched rows", () => {
    const sessions = buildDispatchedMapSessions(dashboardFixture.active_sessions);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].vehicleName).toBe("Renault Master L2");
  });
});

describe("findActiveSession", () => {
  it("finds session by id", () => {
    const found = findActiveSession(
      dashboardFixture.active_sessions,
      "11111111-1111-4111-8111-111111110001",
    );
    expect(found?.vehicle_name).toBe("Renault Master L2");
  });

  it("returns null for unknown id", () => {
    expect(findActiveSession(dashboardFixture.active_sessions, "missing")).toBeNull();
    expect(findActiveSession(dashboardFixture.active_sessions, null)).toBeNull();
  });
});
