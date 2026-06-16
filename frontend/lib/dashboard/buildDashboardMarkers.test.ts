import { describe, expect, it } from "vitest";

import {
  DEFAULT_ORIGIN,
  parseDashboardCoordinates,
} from "@/lib/dashboard/buildDashboardMarkers";

describe("parseDashboardCoordinates", () => {
  it("parses labeled coordinates from backend", () => {
    expect(parseDashboardCoordinates("52.2200°N, 21.0100°E")).toEqual([21.01, 52.22]);
  });

  it("parses plain lat,lon pairs", () => {
    expect(parseDashboardCoordinates("52.2446, 20.9888")).toEqual([20.9888, 52.2446]);
  });

  it("returns null for non-coordinate labels", () => {
    expect(parseDashboardCoordinates("Warszawa, PL")).toBeNull();
    expect(parseDashboardCoordinates("Pickup hub 5")).toBeNull();
  });

  it("falls back to default origin when parsing fails", () => {
    expect(parseDashboardCoordinates("") ?? DEFAULT_ORIGIN).toEqual(DEFAULT_ORIGIN);
  });
});
