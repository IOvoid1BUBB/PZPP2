import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PalletData, VehicleConfig } from "@/lib/types/load";
import { useConflicts, useLoadStore } from "@/lib/stores/loadStore";

function makeVehicle(overrides?: Partial<VehicleConfig>): VehicleConfig {
  return {
    id: "vehicle-test",
    name: "Test trailer",
    type: "solo",
    maxLdm: 20,
    maxWeightKg: 5000,
    trailerLengthCm: 1360,
    trailerWidthCm: 240,
    maxRows: 4,
    payloadSlots: {
      r0_c0: { row: 0, col: 0, ldmPerSlot: 1, xOffsetCm: 0, yOffsetCm: 0 },
      r1_c0: { row: 1, col: 0, ldmPerSlot: 1, xOffsetCm: 0, yOffsetCm: 120 },
      r2_c0: { row: 2, col: 0, ldmPerSlot: 1, xOffsetCm: 0, yOffsetCm: 240 },
      r3_c0: { row: 3, col: 0, ldmPerSlot: 1, xOffsetCm: 0, yOffsetCm: 360 },
    },
    ...overrides,
  };
}

function makePallet(
  id: string,
  overrides?: Partial<PalletData>,
): PalletData {
  return {
    id,
    offerId: `offer-${id}`,
    clientId: `client-${id}`,
    clientName: `Client ${id}`,
    clientColor: `#${id.padEnd(6, "0").slice(0, 6)}`,
    ldm: 1,
    weightKg: 200,
    dims: { wMm: 1200, dMm: 800, hMm: 1800 },
    stackable: true,
    timeWindow: null,
    ...overrides,
  };
}

function resetLoadStore() {
  useLoadStore.setState({
    slots: {},
    vehicle: null,
    sessionId: null,
  });
  sessionStorage.clear();
}

beforeEach(() => {
  resetLoadStore();
});

afterEach(() => {
  resetLoadStore();
});

describe("useLoadStore", () => {
  it("double swap returns original slot state", () => {
    const vehicle = makeVehicle();
    const first = makePallet("a");
    const second = makePallet("b");

    act(() => {
      useLoadStore.getState().setLayout({
        vehicle,
        sessionId: "session-swap",
        slots: {
          r0_c0: first,
          r1_c0: second,
          r2_c0: null,
          r3_c0: null,
        },
      });
    });

    const originalSlots = useLoadStore.getState().slots;

    act(() => {
      useLoadStore.getState().swapSlots("r0_c0", "r1_c0");
      useLoadStore.getState().swapSlots("r0_c0", "r1_c0");
    });

    expect(useLoadStore.getState().slots).toEqual(originalSlots);
  });

  it("reports stacking violation when cargo sits above non-stackable pallet", () => {
    const vehicle = makeVehicle();
    const { result } = renderHook(() => useConflicts());

    act(() => {
      useLoadStore.getState().setLayout({
        vehicle,
        sessionId: "session-conflict",
        slots: {
          r0_c0: makePallet("bottom", { stackable: false }),
          r1_c0: makePallet("top"),
          r2_c0: null,
          r3_c0: null,
        },
      });
    });

    expect(result.current).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "stacking_violation",
          affectedSlotIds: ["r0_c0", "r1_c0"],
        }),
      ]),
    );
  });

  it("autoArrange keeps heavy pallets in lower half rows", () => {
    const vehicle = makeVehicle();
    const heavy = makePallet("heavy", { weightKg: 900, ldm: 2 });
    const light = makePallet("light", { weightKg: 200, ldm: 1 });

    act(() => {
      useLoadStore.getState().setLayout({
        vehicle,
        sessionId: "session-arrange",
        slots: {
          r0_c0: light,
          r1_c0: null,
          r2_c0: heavy,
          r3_c0: null,
        },
      });
      useLoadStore.getState().autoArrange();
    });

    const heavyEntry = Object.entries(useLoadStore.getState().slots).find(
      ([, pallet]) => pallet?.id === heavy.id,
    );

    expect(heavyEntry).toBeDefined();
    expect(heavyEntry![0]).toMatch(/^r[23]_c0$/);
  });

  it("rehydrates persisted state from sessionStorage with Date fields restored", async () => {
    const deliveryTime = new Date("2026-05-26T10:00:00.000Z");
    const open = new Date("2026-05-26T09:00:00.000Z");
    const close = new Date("2026-05-26T11:00:00.000Z");

    act(() => {
      useLoadStore.getState().setLayout({
        vehicle: makeVehicle({ deliveryTime }),
        sessionId: "session-persist",
        slots: {
          r0_c0: makePallet("persisted", {
            timeWindow: { open, close },
          }),
          r1_c0: null,
          r2_c0: null,
          r3_c0: null,
        },
      });
    });

    const persistedSnapshot = sessionStorage.getItem("load-store");
    expect(persistedSnapshot).not.toBeNull();

    act(() => {
      useLoadStore.setState({
        slots: {},
        vehicle: null,
        sessionId: null,
      });
    });

    sessionStorage.setItem("load-store", persistedSnapshot!);

    await act(async () => {
      await useLoadStore.persist.rehydrate();
    });

    const state = useLoadStore.getState();
    expect(state.sessionId).toBe("session-persist");
    expect(state.vehicle?.deliveryTime).toBeInstanceOf(Date);
    expect(state.slots.r0_c0?.timeWindow?.open).toBeInstanceOf(Date);
    expect(state.slots.r0_c0?.timeWindow?.close).toBeInstanceOf(Date);
  });
});
