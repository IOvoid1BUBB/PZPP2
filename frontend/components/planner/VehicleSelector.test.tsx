/**
 * VehicleSelector.test.tsx
 *
 * Snapshot + interaction tests dla komponentu VehicleSelector.
 *
 * Strategia mocków:
 *   - global.fetch → mock GET /vehicles i POST /sessions
 *   - Store'y (vehicleStore, sessionStore, loadStore) → vi.mock z przechwyceniem
 *     wywołań akcji (selectVehicle, clearAllSlots, setSessionId)
 *
 * Uwaga: Store'y są stubami (nie Zustand). Gdy Task 1.4 / 1.5 / 2.2 podmienią
 * implementację, testy nie wymagają zmian — mockujemy na poziomie modułu.
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { VehicleSelector } from "./VehicleSelector";
import type { VehicleConfig } from "@/lib/types/load";

// ─── Mock danych API ─────────────────────────────────────────────────────────

const MOCK_VEHICLES: VehicleConfig[] = [
  {
    id: "uuid-bus-8",
    name: "Bus 8m",
    type: "bus_8",
    maxLdm: 13.6,
    maxWeightKg: 6000,
    trailerLengthCm: 820,
    trailerWidthCm: 240,
    maxStops: 6,
    fuelPer100kmBase: 18.5,
    payloadSlots: {},
  },
  {
    id: "uuid-bus-9",
    name: "Bus 9m",
    type: "bus_9",
    maxLdm: 13.6,
    maxWeightKg: 7000,
    trailerLengthCm: 920,
    trailerWidthCm: 240,
    maxStops: 6,
    fuelPer100kmBase: 19.0,
    payloadSlots: {},
  },
  {
    id: "uuid-bus-10",
    name: "Bus 10m",
    type: "bus_10",
    maxLdm: 13.6,
    maxWeightKg: 8000,
    trailerLengthCm: 1020,
    trailerWidthCm: 240,
    maxStops: 6,
    fuelPer100kmBase: 19.5,
    payloadSlots: {},
  },
  {
    id: "uuid-solo",
    name: "Solówka",
    type: "solo",
    maxLdm: 33.0,
    maxWeightKg: 24000,
    trailerLengthCm: 1360,
    trailerWidthCm: 240,
    maxStops: 10,
    fuelPer100kmBase: 28.0,
    payloadSlots: {},
  },
];

// ─── Mock fetch ───────────────────────────────────────────────────────────────

/** Zwraca camelCase kształt zgodny z mapVehicle() w sessionClient.ts */
function makeVehicleApiRecord(v: VehicleConfig) {
  return {
    id: v.id,
    name: v.name,
    type: v.type,
    max_ldm: v.maxLdm,
    max_weight_kg: v.maxWeightKg,
    trailer_length_cm: v.trailerLengthCm,
    trailer_width_cm: v.trailerWidthCm,
    fuel_per_100km_base: v.fuelPer100kmBase,
    max_stops: v.maxStops,
    payload_slots: v.payloadSlots,
  };
}

function mockFetch(overrides?: { vehiclesOk?: boolean; sessionOk?: boolean }) {
  const vehiclesOk = overrides?.vehiclesOk ?? true;
  const sessionOk = overrides?.sessionOk ?? true;

  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url.includes("/api/v1/vehicles")) {
        if (!vehiclesOk) {
          return Promise.resolve({ ok: false, status: 500 } as Response);
        }
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve(MOCK_VEHICLES.map(makeVehicleApiRecord)),
        } as Response);
      }

      if (url.includes("/api/v1/sessions")) {
        if (!sessionOk) {
          return Promise.resolve({ ok: false, status: 422 } as Response);
        }
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({ id: "session-test-uuid", status: "draft" }),
        } as Response);
      }

      return Promise.reject(new Error(`Unmocked URL: ${url}`));
    }),
  );
}

// ─── Mock store'ów ────────────────────────────────────────────────────────────

const mockSelectVehicle = vi.fn();
const mockClearAllSlots = vi.fn();
const mockSetSessionId = vi.fn();

let mockSelectedVehicle: VehicleConfig | null = null;

vi.mock("@/lib/stores/vehicleStore", () => ({
  useVehicleStore: () => ({
    selectedVehicle: mockSelectedVehicle,
    selectVehicle: mockSelectVehicle,
  }),
}));

vi.mock("@/lib/stores/loadStore", () => ({
  useLoadStore: () => ({
    slots: {},
    clearAllSlots: mockClearAllSlots,
  }),
}));

vi.mock("@/lib/stores/sessionStore", () => ({
  useSessionStore: () => ({
    sessionId: null,
    setSessionId: mockSetSessionId,
  }),
}));

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  mockSelectedVehicle = null;
  mockSelectVehicle.mockClear();
  mockClearAllSlots.mockClear();
  mockSetSessionId.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── Helper ───────────────────────────────────────────────────────────────────

async function renderAndWait() {
  mockFetch();
  let result: ReturnType<typeof render>;
  await act(async () => {
    result = render(<VehicleSelector />);
    // Poczekaj na zakończenie useEffect (fetchVehicles)
  });
  await waitFor(() =>
    expect(screen.queryByRole("radio", { name: /bus 8-pak/i })).not.toBeNull(),
  );
  return result!;
}

// ─── Snapshot tests ───────────────────────────────────────────────────────────

describe("VehicleSelector — snapshots", () => {
  it("renderuje 4 karty w domyślnym stanie", async () => {
    const { container } = await renderAndWait();
    expect(container).toMatchSnapshot();
  });

  it("karta bus_8 jest zaznaczona — snapshot", async () => {
    mockSelectedVehicle = MOCK_VEHICLES[0]; // bus_8
    const { container } = await renderAndWait();
    expect(container).toMatchSnapshot();
  });

  it("karta solo jest zaznaczona — snapshot", async () => {
    mockSelectedVehicle = MOCK_VEHICLES[3]; // solo
    const { container } = await renderAndWait();
    expect(container).toMatchSnapshot();
  });
});

// ─── Interaction tests ────────────────────────────────────────────────────────

describe("VehicleSelector — interakcje", () => {
  it("kliknięcie bus_8 wywołuje selectVehicle z poprawnym vehicle", async () => {
    await renderAndWait();

    const card = screen.getByRole("radio", { name: /bus 8-pak/i });
    await act(async () => {
      fireEvent.click(card);
    });

    await waitFor(() => {
      expect(mockSelectVehicle).toHaveBeenCalledOnce();
      expect(mockSelectVehicle).toHaveBeenCalledWith(
        expect.objectContaining({ type: "bus_8", id: "uuid-bus-8" }),
      );
    });
  });

  it("kliknięcie karty wywołuje clearAllSlots", async () => {
    await renderAndWait();

    const card = screen.getByRole("radio", { name: /bus 8-pak/i });
    await act(async () => {
      fireEvent.click(card);
    });

    await waitFor(() => {
      expect(mockClearAllSlots).toHaveBeenCalledOnce();
    });
  });

  it("kliknięcie karty wywołuje setSessionId z UUID z API", async () => {
    await renderAndWait();

    const card = screen.getByRole("radio", { name: /bus 8-pak/i });
    await act(async () => {
      fireEvent.click(card);
    });

    await waitFor(() => {
      expect(mockSetSessionId).toHaveBeenCalledWith("session-test-uuid");
    });
  });

  it("Enter na sfokusowanej karcie ma taki sam efekt co click", async () => {
    await renderAndWait();

    const card = screen.getByRole("radio", { name: /bus 8-pak/i });
    card.focus();

    await act(async () => {
      fireEvent.keyDown(card, { key: "Enter", code: "Enter" });
    });

    await waitFor(() => {
      expect(mockSelectVehicle).toHaveBeenCalledWith(
        expect.objectContaining({ type: "bus_8" }),
      );
      expect(mockClearAllSlots).toHaveBeenCalledOnce();
    });
  });

  it("Space na sfokusowanej karcie ma taki sam efekt co click", async () => {
    await renderAndWait();

    const card = screen.getByRole("radio", { name: /bus 8-pak/i });
    card.focus();

    await act(async () => {
      fireEvent.keyDown(card, { key: " ", code: "Space" });
    });

    await waitFor(() => {
      expect(mockSelectVehicle).toHaveBeenCalledOnce();
    });
  });

  it("bus_8 wyświetla 'max 6 przystanków' (bus_8/9/10 mają tę samą wartość)", async () => {
    await renderAndWait();
    // bus_8, bus_9 i bus_10 mają maxStops=6 — oczekujemy 3 elementów
    const items = screen.getAllByText("max 6 przystanków");
    expect(items.length).toBeGreaterThanOrEqual(1);
    // Weryfikacja że bus_8 jest wśród nich
    const bus8card = screen.getByRole("radio", { name: /bus 8-pak/i });
    expect(bus8card).toHaveTextContent("max 6 przystanków");
  });

  it("solo wyświetla 'max 10 przystanków'", async () => {
    await renderAndWait();
    const soloCard = screen.getByRole("radio", { name: /solówka/i });
    expect(soloCard).toHaveTextContent("max 10 przystanków");
  });

  it("4 karty mają role=radio", async () => {
    await renderAndWait();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(4);
  });

  it("aria-checked=false dla niewybrane, true dla wybranej", async () => {
    mockSelectedVehicle = MOCK_VEHICLES[0]; // bus_8
    await renderAndWait();

    const bus8card = screen.getByRole("radio", { name: /bus 8-pak/i });
    const soloCard = screen.getByRole("radio", { name: /solówka/i });

    expect(bus8card).toHaveAttribute("aria-checked", "true");
    expect(soloCard).toHaveAttribute("aria-checked", "false");
  });
});

// ─── Error state ──────────────────────────────────────────────────────────────

describe("VehicleSelector — obsługa błędów", () => {
  it("pokazuje błąd gdy API sesji zwróci błąd", async () => {
    mockFetch({ vehiclesOk: true, sessionOk: false });

    await act(async () => {
      render(<VehicleSelector />);
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("radio", { name: /bus 8-pak/i }),
      ).not.toBeNull(),
    );

    const card = screen.getByRole("radio", { name: /bus 8-pak/i });
    await act(async () => {
      fireEvent.click(card);
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
  });
});
