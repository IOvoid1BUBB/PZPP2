import { describe, expect, it } from "vitest";

import { buildMapsLink, buildRouteBriefing } from "@/lib/driver/buildRouteBriefing";
import type { RouteMapData } from "@/lib/types/routeMap";

function makeRouteMap(overrides: Partial<RouteMapData> = {}): RouteMapData {
  return {
    sessionId: "sess-1",
    origin: { lat: 52.22, lon: 21.01 },
    vehicleMaxWeightKg: 24000,
    totalDistanceKm: 96.4,
    totalDurationMinutes: 142,
    fromApi: true,
    legs: [],
    stops: [
      {
        id: "s1",
        offerId: "o1",
        stopType: "pickup",
        sequenceOrder: 0,
        location: { lat: 52.18, lon: 20.85 },
        etaMinutesFromStart: 45,
        stopCostEur: 28,
        addressLabel: "Odbiór · Warszawa",
        handlingTimeMinutes: 30,
        isCurrent: true,
        pinLabel: "P1",
      },
      {
        id: "s2",
        offerId: "o1",
        stopType: "delivery",
        sequenceOrder: 1,
        location: { lat: 51.95, lon: 20.55 },
        etaMinutesFromStart: 120,
        stopCostEur: 32,
        addressLabel: "Dostawa · Łódź",
        handlingTimeMinutes: 25,
        isCurrent: false,
        pinLabel: "D1",
      },
    ],
    ...overrides,
  };
}

const SESSION_DETAIL = {
  driver_profile: { name: "Jan Kowalski" },
  vehicle: { name: "MAN Solówka" },
} as never;

describe("buildMapsLink", () => {
  it("builds a Google Maps query link from lat/lon", () => {
    expect(buildMapsLink({ lat: 52.18, lon: 20.85 })).toBe(
      "https://maps.google.com/?q=52.18,20.85",
    );
  });
});

describe("buildRouteBriefing", () => {
  const now = new Date("2026-06-15T08:00:00.000Z");

  it("maps driver and vehicle names from session detail", () => {
    const briefing = buildRouteBriefing(makeRouteMap(), SESSION_DETAIL, now);
    expect(briefing.driverName).toBe("Jan Kowalski");
    expect(briefing.vehicleName).toBe("MAN Solówka");
  });

  it("falls back to dashes when session detail is missing", () => {
    const briefing = buildRouteBriefing(makeRouteMap(), null, now);
    expect(briefing.driverName).toBe("—");
    expect(briefing.vehicleName).toBe("—");
  });

  it("accepts a plain meta object", () => {
    const briefing = buildRouteBriefing(
      makeRouteMap(),
      { driverName: "Anna", vehicleName: "Master L2" },
      now,
    );
    expect(briefing.driverName).toBe("Anna");
    expect(briefing.vehicleName).toBe("Master L2");
  });

  it("copies totals from the route map", () => {
    const briefing = buildRouteBriefing(makeRouteMap(), SESSION_DETAIL, now);
    expect(briefing.totals).toEqual({
      distanceKm: 96.4,
      durationMinutes: 142,
      stopCount: 2,
    });
  });

  it("builds stops with maps links and preserves order", () => {
    const briefing = buildRouteBriefing(makeRouteMap(), SESSION_DETAIL, now);
    expect(briefing.stops).toHaveLength(2);
    expect(briefing.stops[0].pinLabel).toBe("P1");
    expect(briefing.stops[0].mapsLink).toBe(
      "https://maps.google.com/?q=52.18,20.85",
    );
    expect(briefing.stops[1].pinLabel).toBe("D1");
    expect(briefing.stops[1].etaMinutesFromStart).toBe(120);
  });

  it("uses the injected timestamp for generatedAt", () => {
    const briefing = buildRouteBriefing(makeRouteMap(), SESSION_DETAIL, now);
    expect(briefing.generatedAt).toBe("2026-06-15T08:00:00.000Z");
  });

  it("produces an empty stop list when there are no stops", () => {
    const briefing = buildRouteBriefing(
      makeRouteMap({ stops: [] }),
      SESSION_DETAIL,
      now,
    );
    expect(briefing.stops).toHaveLength(0);
    expect(briefing.totals.stopCount).toBe(0);
  });
});
