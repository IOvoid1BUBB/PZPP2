import { describe, expect, it } from "vitest";

import type { DashboardSessionSummary } from "@/lib/api/dashboardClient";
import type { FleetVehicle } from "@/lib/api/fleetClient";
import {
  centerFromMarkers,
  pickFocusSessionId,
  sessionStatusLabel,
} from "@/lib/dashboard/pickFocusSession";

function session(
  overrides: Partial<DashboardSessionSummary> = {},
): DashboardSessionSummary {
  return {
    id: "11112222-3333-4444-5555-666677778888",
    status: "draft",
    created_at: "2026-06-16T12:00:00Z",
    vehicle_name: "MAN",
    stop_count: 0,
    offer_count: 0,
    estimated_net_profit_eur: null,
    ...overrides,
  };
}

function fleet(overrides: Partial<FleetVehicle> = {}): FleetVehicle {
  return {
    id: "fleet-1",
    typeId: "type-1",
    typeKey: "man_solo",
    typeName: "MAN",
    registration: "WA1234",
    displayName: "Truck 1",
    status: "idle",
    maxLdm: 17.6,
    maxWeightKg: 12000,
    trailerLengthCm: 890,
    trailerWidthCm: 245,
    payloadSlots: {},
    homeLat: 52.22,
    homeLon: 21.01,
    currentLat: null,
    currentLon: null,
    currentSessionId: null,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("pickFocusSessionId", () => {
  it("prefers the in-route fleet vehicle session", () => {
    const sessions = [
      session({ id: "empty-draft", offer_count: 0 }),
      session({ id: "loaded-draft", offer_count: 2 }),
    ];
    const vehicles = [
      fleet({ status: "in_route", currentSessionId: "empty-draft" }),
    ];
    expect(pickFocusSessionId(sessions, vehicles)).toBe("empty-draft");
  });

  it("falls back to loaded confirmed session", () => {
    const sessions = [
      session({ id: "draft-empty" }),
      session({ id: "confirmed-loaded", status: "confirmed", offer_count: 3 }),
    ];
    expect(pickFocusSessionId(sessions, [])).toBe("confirmed-loaded");
  });
});

describe("sessionStatusLabel", () => {
  it("maps known statuses to Polish labels", () => {
    expect(sessionStatusLabel("dispatched")).toBe("Trasa w drodze");
    expect(sessionStatusLabel("draft")).toBe("Szkic sesji");
  });
});

describe("centerFromMarkers", () => {
  it("returns the midpoint of marker coordinates", () => {
    expect(
      centerFromMarkers([
        { coordinates: [10, 50] },
        { coordinates: [20, 60] },
      ]),
    ).toEqual([15, 55]);
  });
});
