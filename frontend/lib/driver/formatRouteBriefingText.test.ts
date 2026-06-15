import { describe, expect, it } from "vitest";

import {
  formatEtaFromStart,
  formatRouteBriefingPlainText,
} from "@/lib/driver/formatRouteBriefingText";
import type { DriverRouteBriefing } from "@/lib/types/driverBriefing";

function makeBriefing(
  overrides: Partial<DriverRouteBriefing> = {},
): DriverRouteBriefing {
  return {
    sessionId: "sess-1",
    driverName: "Jan Kowalski",
    vehicleName: "MAN Solówka",
    origin: { lat: 52.22, lon: 21.01 },
    totals: { distanceKm: 96.4, durationMinutes: 142, stopCount: 2 },
    generatedAt: "2026-06-15T08:00:00.000Z",
    stops: [
      {
        pinLabel: "P1",
        stopType: "pickup",
        addressLabel: "Odbiór · Warszawa",
        location: { lat: 52.18, lon: 20.85 },
        etaMinutesFromStart: 45,
        handlingTimeMinutes: 30,
        mapsLink: "https://maps.google.com/?q=52.18,20.85",
      },
      {
        pinLabel: "D1",
        stopType: "delivery",
        addressLabel: "Dostawa · Łódź",
        location: { lat: 51.95, lon: 20.55 },
        etaMinutesFromStart: 120,
        handlingTimeMinutes: 25,
        mapsLink: "https://maps.google.com/?q=51.95,20.55",
      },
    ],
    ...overrides,
  };
}

describe("formatEtaFromStart", () => {
  it("returns a dash for null", () => {
    expect(formatEtaFromStart(null)).toBe("—");
  });

  it("formats sub-hour values in minutes", () => {
    expect(formatEtaFromStart(45)).toBe("+45 min");
  });

  it("formats hour+ values with zero-padded minutes", () => {
    expect(formatEtaFromStart(125)).toBe("+2 h 05 min");
  });
});

describe("formatRouteBriefingPlainText", () => {
  it("includes header with driver, vehicle, origin and totals", () => {
    const text = formatRouteBriefingPlainText(makeBriefing());
    expect(text).toContain("PLAN TRASY");
    expect(text).toContain("Kierowca: Jan Kowalski | Pojazd: MAN Solówka");
    expect(text).toContain("Start: 52.22000, 21.01000");
    expect(text).toContain("Dystans: 96.4 km | Czas: 142 min | Postoje: 2");
  });

  it("renders every stop with GPS, ETA, handling and maps link", () => {
    const text = formatRouteBriefingPlainText(makeBriefing());
    expect(text).toContain("1. P1 — Odbiór");
    expect(text).toContain("GPS: 52.18000, 20.85000");
    expect(text).toContain("ETA: +45 min | Obsługa: 30 min");
    expect(text).toContain("Mapa: https://maps.google.com/?q=52.18,20.85");
    expect(text).toContain("2. D1 — Dostawa");
    expect(text).toContain("ETA: +2 h 00 min | Obsługa: 25 min");
  });

  it("handles missing ETA and handling gracefully", () => {
    const text = formatRouteBriefingPlainText(
      makeBriefing({
        stops: [
          {
            pinLabel: "P1",
            stopType: "pickup",
            addressLabel: "Odbiór · Warszawa",
            location: { lat: 52.18, lon: 20.85 },
            etaMinutesFromStart: null,
            handlingTimeMinutes: null,
            mapsLink: "https://maps.google.com/?q=52.18,20.85",
          },
        ],
      }),
    );
    expect(text).toContain("ETA: — | Obsługa: —");
  });

  it("returns a readable message when there are no stops", () => {
    const text = formatRouteBriefingPlainText(makeBriefing({ stops: [] }));
    expect(text).toContain("Brak zaplanowanych postojów.");
  });
});
