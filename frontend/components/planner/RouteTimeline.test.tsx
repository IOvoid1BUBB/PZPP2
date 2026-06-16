import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DriverRestPoint, RouteStop } from "@/lib/types/routeMap";

import {
  buildTimelineEvents,
  formatRouteOffset,
  RouteTimeline,
} from "./RouteTimeline";

function makeStop(overrides: Partial<RouteStop> = {}): RouteStop {
  return {
    id: "s1",
    offerId: "o1",
    stopType: "pickup",
    sequenceOrder: 0,
    location: { lat: 52.2, lon: 21.0 },
    etaMinutesFromStart: 60,
    stopCostEur: 10,
    addressLabel: "Odbiór · Warszawa",
    handlingTimeMinutes: 30,
    isCurrent: false,
    pinLabel: "P1",
    ...overrides,
  };
}

function makeRest(overrides: Partial<DriverRestPoint> = {}): DriverRestPoint {
  return {
    lat: 52.0,
    lon: 20.5,
    restType: "break_45",
    afterDrivingMinutes: 270,
    legId: 1,
    atRouteMinute: 270,
    ...overrides,
  };
}

describe("formatRouteOffset", () => {
  it("formats sub-hour offsets in minutes", () => {
    expect(formatRouteOffset(45)).toBe("+ 45 min");
  });

  it("formats whole-hour offsets without minutes", () => {
    expect(formatRouteOffset(120)).toBe("+ 2 h");
  });

  it("formats mixed hour + minute offsets", () => {
    expect(formatRouteOffset(200)).toBe("+ 3 h 20 min");
  });

  it("clamps negative values to zero", () => {
    expect(formatRouteOffset(-30)).toBe("+ 0 min");
  });
});

describe("buildTimelineEvents", () => {
  it("always starts with the origin event at minute 0", () => {
    const events = buildTimelineEvents([], []);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "origin", atMinute: 0 });
  });

  it("interleaves rest points between stops by route minute", () => {
    const stops = [
      makeStop({ id: "a", pinLabel: "P1", etaMinutesFromStart: 60 }),
      makeStop({
        id: "b",
        pinLabel: "D1",
        stopType: "delivery",
        sequenceOrder: 1,
        etaMinutesFromStart: 360,
      }),
    ];
    const rest = makeRest({ atRouteMinute: 270 });

    const kinds = buildTimelineEvents(stops, [rest]).map((e) => e.kind);
    expect(kinds).toEqual(["origin", "pickup", "break_45", "delivery"]);
  });

  it("sorts stops by sequenceOrder, not array order", () => {
    const stops = [
      makeStop({ id: "late", pinLabel: "D1", sequenceOrder: 2, etaMinutesFromStart: 300 }),
      makeStop({ id: "early", pinLabel: "P1", sequenceOrder: 1, etaMinutesFromStart: 90 }),
    ];
    const titles = buildTimelineEvents(stops, []).map((e) => e.title);
    expect(titles).toEqual(["Baza", "P1", "D1"]);
  });

  it("carries forward the last known minute when ETA is missing", () => {
    const stops = [
      makeStop({ id: "a", pinLabel: "P1", sequenceOrder: 0, etaMinutesFromStart: 100 }),
      makeStop({ id: "b", pinLabel: "D1", sequenceOrder: 1, etaMinutesFromStart: null }),
    ];
    const events = buildTimelineEvents(stops, []);
    const missing = events.find((e) => e.title === "D1");
    expect(missing?.atMinute).toBeNull();
    expect(missing?.sort).toBe(100);
  });
});

describe("RouteTimeline", () => {
  it("shows an empty hint when there are no stops", () => {
    render(
      <RouteTimeline stops={[]} restPoints={[]} totalDurationMinutes={0} />,
    );
    expect(
      screen.getByText("Dodaj ładunki, aby zobaczyć trasę"),
    ).toBeInTheDocument();
  });

  it("renders stops and rest labels with offsets", () => {
    render(
      <RouteTimeline
        stops={[makeStop({ etaMinutesFromStart: 200 })]}
        restPoints={[makeRest({ restType: "rest_11h", atRouteMinute: 270 })]}
        totalDurationMinutes={500}
      />,
    );
    expect(screen.getByText("Baza")).toBeInTheDocument();
    expect(screen.getByText("P1")).toBeInTheDocument();
    expect(screen.getByText("+ 3 h 20 min")).toBeInTheDocument();
    expect(screen.getByText("Nocleg 11h")).toBeInTheDocument();
  });
});
