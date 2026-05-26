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
    id: "uuid-master-l2",
    name: "Renault Master L2",
    type: "master_l2",
    maxLdm: 6.4,
    maxWeightKg: 3500,
    trailerLengthCm: 420,
    trailerWidthCm: 220,
    maxStops: 6,
    fuelPer100kmBase: 18.5,
    payloadSlots: {},
  },
  {
    id: "uuid-master-l3",
    name: "Renault Master L3",
    type: "master_l3",
    maxLdm: 7.2,
    maxWeightKg: 3600,
    trailerLengthCm: 440,
    trailerWidthCm: 220,
    maxStops: 6,
    fuelPer100kmBase: 18.5,
    payloadSlots: {},
  },
  {
    id: "uuid-master-l4",
    name: "Renault Master L4",
    type: "master_l4",
    maxLdm: 8.0,
    maxWeightKg: 3800,
    trailerLengthCm: 484,
    trailerWidthCm: 220,
    maxStops: 6,
    fuelPer100kmBase: 19.0,
    payloadSlots: {},
  },
  {
    id: "uuid-man-solo",
    name: "MAN Solówka",
    type: "man_solo",
    maxLdm: 17.6,
    maxWeightKg: 24000,
    trailerLengthCm: 890,
    trailerWidthCm: 245,
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
  });
  await waitFor(() =>
    expect(
      screen.queryByRole("radio", { name: /renault master l2/i }),
    ).not.toBeNull(),
  );
  return result!;
}

// ─── Snapshot tests ───────────────────────────────────────────────────────────

describe("VehicleSelector — snapshots", () => {
  it("renderuje 4 karty w domyślnym stanie", async () => {
    const { container } = await renderAndWait();
    expect(container).toMatchSnapshot();
  });

  it("karta master_l2 jest zaznaczona — snapshot", async () => {
    mockSelectedVehicle = MOCK_VEHICLES[0];
    const { container } = await renderAndWait();
    expect(container).toMatchSnapshot();
  });

  it("karta man_solo jest zaznaczona — snapshot", async () => {
    mockSelectedVehicle = MOCK_VEHICLES[3];
    const { container } = await renderAndWait();
    expect(container).toMatchSnapshot();
  });
});

// ─── Interaction tests ────────────────────────────────────────────────────────

describe("VehicleSelector — interakcje", () => {
  it("kliknięcie master_l2 wywołuje selectVehicle z poprawnym vehicle", async () => {
    await renderAndWait();

    const card = screen.getByRole("radio", { name: /renault master l2/i });
    await act(async () => {
      fireEvent.click(card);
    });

    await waitFor(() => {
      expect(mockSelectVehicle).toHaveBeenCalledOnce();
      expect(mockSelectVehicle).toHaveBeenCalledWith(
        expect.objectContaining({ type: "master_l2", id: "uuid-master-l2" }),
      );
    });
  });

  it("kliknięcie karty wywołuje clearAllSlots", async () => {
    await renderAndWait();

    const card = screen.getByRole("radio", { name: /renault master l2/i });
    await act(async () => {
      fireEvent.click(card);
    });

    await waitFor(() => {
      expect(mockClearAllSlots).toHaveBeenCalledOnce();
    });
  });

  it("kliknięcie karty wywołuje setSessionId z UUID z API", async () => {
    await renderAndWait();

    const card = screen.getByRole("radio", { name: /renault master l2/i });
    await act(async () => {
      fireEvent.click(card);
    });

    await waitFor(() => {
      expect(mockSetSessionId).toHaveBeenCalledWith("session-test-uuid");
    });
  });

  it("Enter na sfokusowanej karcie ma taki sam efekt co click", async () => {
    await renderAndWait();

    const card = screen.getByRole("radio", { name: /renault master l2/i });
    card.focus();

    await act(async () => {
      fireEvent.keyDown(card, { key: "Enter", code: "Enter" });
    });

    await waitFor(() => {
      expect(mockSelectVehicle).toHaveBeenCalledWith(
        expect.objectContaining({ type: "master_l2" }),
      );
      expect(mockClearAllSlots).toHaveBeenCalledOnce();
    });
  });

  it("Space na sfokusowanej karcie ma taki sam efekt co click", async () => {
    await renderAndWait();

    const card = screen.getByRole("radio", { name: /renault master l2/i });
    card.focus();

    await act(async () => {
      fireEvent.keyDown(card, { key: " ", code: "Space" });
    });

    await waitFor(() => {
      expect(mockSelectVehicle).toHaveBeenCalledOnce();
    });
  });

  it("master_l2 wyświetla 'max 6 przystanków'", async () => {
    await renderAndWait();
    const items = screen.getAllByText("max 6 przystanków");
    expect(items.length).toBeGreaterThanOrEqual(1);
    const l2Card = screen.getByRole("radio", { name: /renault master l2/i });
    expect(l2Card).toHaveTextContent("max 6 przystanków");
  });

  it("man_solo wyświetla 'max 10 przystanków'", async () => {
    await renderAndWait();
    const soloCard = screen.getByRole("radio", { name: /man solówka/i });
    expect(soloCard).toHaveTextContent("max 10 przystanków");
  });

  it("4 karty mają role=radio", async () => {
    await renderAndWait();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(4);
  });

  it("aria-checked=false dla niewybrane, true dla wybranej", async () => {
    mockSelectedVehicle = MOCK_VEHICLES[0];
    await renderAndWait();

    const l2Card = screen.getByRole("radio", { name: /renault master l2/i });
    const soloCard = screen.getByRole("radio", { name: /man solówka/i });

    expect(l2Card).toHaveAttribute("aria-checked", "true");
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
        screen.queryByRole("radio", { name: /renault master l2/i }),
      ).not.toBeNull(),
    );

    const card = screen.getByRole("radio", { name: /renault master l2/i });
    await act(async () => {
      fireEvent.click(card);
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
  });
});
