/**
 * RouteMapClient.test.tsx
 *
 * Testy stanu pustego (UX-03 / 9.3): gdy sesja nie ma jeszcze trasy, mapa
 * pokazuje współdzielony EmptyState z komunikatem „Dodaj oferty, aby zobaczyć
 * trasę”, a nie pusty biały panel.
 *
 * Leaflet i react-leaflet są mockowane — w ścieżce pustego stanu mapa nie jest
 * montowana, więc wystarczy, by importy się rozwiązały.
 */

import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("leaflet", () => ({
  default: { divIcon: vi.fn(() => ({})), Map: class {} },
}));

vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children?: ReactNode }) => (
    <div data-testid="map-container">{children}</div>
  ),
  Marker: () => null,
  Polyline: () => null,
  Popup: () => null,
  TileLayer: () => null,
  useMap: () => ({}),
}));

const mockFetchRouteMap = vi.fn();
vi.mock("@/lib/api/mapClient", () => ({
  fetchSessionRouteMap: (...args: unknown[]) => mockFetchRouteMap(...args),
}));

// Komponenty montowane tylko w widoku pełnej trasy — mockujemy je na wszelki wypadek.
vi.mock("@/components/driver/DriverRouteBriefing", () => ({
  DriverRouteBriefing: () => null,
}));
vi.mock("@/components/planner/RouteTimeline", () => ({
  RouteTimeline: () => null,
}));

import RouteMapClient from "./RouteMapClient";

describe("RouteMapClient — pusty stan (9.3)", () => {
  beforeEach(() => {
    mockFetchRouteMap.mockReset();
  });

  it("pokazuje EmptyState z komunikatem mapy gdy brak trasy", async () => {
    mockFetchRouteMap.mockResolvedValue(null);

    render(<RouteMapClient sessionId="session-1" />);

    await waitFor(() => {
      expect(
        screen.getByText("Dodaj oferty, aby zobaczyć trasę"),
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
  });

  it("pokazuje komunikat błędu (nie EmptyState) gdy fetch rzuci", async () => {
    mockFetchRouteMap.mockRejectedValue(new Error("Boom sieci"));

    render(<RouteMapClient sessionId="session-1" />);

    await waitFor(() => {
      expect(screen.getByText("Boom sieci")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("empty-state")).not.toBeInTheDocument();
  });
});
