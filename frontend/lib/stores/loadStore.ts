"use client";

import { useMemo } from "react";
import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";
import { useShallow } from "zustand/shallow";

import { getCompanyColorPair } from "@/lib/colors/companyColors";
import {
  detectDimensionViolations,
  detectStackingViolations,
  normalizePayloadSlots,
} from "@/lib/load/capacity";
import type { PalletData, SlotConflict, VehicleConfig } from "@/lib/types/load";

export type { PalletData, SlotConflict, VehicleConfig } from "@/lib/types/load";

export interface LoadStore {
  slots: Record<string, PalletData | null>;
  vehicle: VehicleConfig | null;
  sessionId: string | null;
  sessionOfferIds: string[];
  assignPallet: (slotId: string, pallet: PalletData) => void;
  removePallet: (slotId: string) => void;
  swapSlots: (slotA: string, slotB: string) => void;
  clearAllSlots: () => void;
  autoArrange: () => void;
  setVehicle: (vehicle: VehicleConfig) => void;
  setSessionId: (sessionId: string | null) => void;
  setSessionOfferIds: (offerIds: string[]) => void;
  applyBulkOffers: (offerIds: string[]) => void;
  setSlots: (slots: Record<string, PalletData | null>) => void;
  setLayout: (layout: PersistedLoadStore) => void;
}

type PersistedLoadStore = Pick<LoadStore, "slots" | "vehicle" | "sessionId"> & {
  sessionOfferIds?: string[];
};

interface SlotMeta {
  id: string;
  row: number;
  col: number;
}

export interface ClientSummary {
  clientId: string;
  offerId: string;
  name: string;
  color: string;
  ldm: number;
  weight: number;
}

const SLOT_ID_PATTERN = /^r(?<row>\d+)_c(?<col>\d+)$/;

const noopStorage: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizePallet(pallet: PalletData): PalletData {
  if (!pallet.timeWindow) {
    return { ...pallet, timeWindow: null };
  }

  const open = toDate(pallet.timeWindow.open);
  const close = toDate(pallet.timeWindow.close);

  return {
    ...pallet,
    timeWindow: open && close ? { open, close } : null,
  };
}

function normalizeSlots(
  slots: Record<string, PalletData | null>,
): Record<string, PalletData | null> {
  return Object.fromEntries(
    Object.entries(slots).map(([slotId, pallet]) => [
      slotId,
      pallet ? normalizePallet(pallet) : null,
    ]),
  );
}

function normalizeVehicle(vehicle: VehicleConfig): VehicleConfig {
  const deliveryTime = toDate(vehicle.deliveryTime ?? null);

  return {
    ...vehicle,
    payloadSlots: normalizePayloadSlots(vehicle.payloadSlots),
    deliveryTime: deliveryTime ?? vehicle.deliveryTime ?? null,
  };
}

function isPallet(value: PalletData | null | undefined): value is PalletData {
  return value !== null && value !== undefined;
}

function getVehicleSlotIds(
  vehicle: VehicleConfig | null,
  slots: Record<string, PalletData | null>,
): string[] {
  const vehicleSlotIds = vehicle ? Object.keys(vehicle.payloadSlots) : [];
  return vehicleSlotIds.length > 0 ? vehicleSlotIds : Object.keys(slots);
}

function parseSlotMeta(slotId: string): SlotMeta | null {
  const match = SLOT_ID_PATTERN.exec(slotId);
  if (!match?.groups) {
    return null;
  }

  return {
    id: slotId,
    row: Number.parseInt(match.groups.row, 10),
    col: Number.parseInt(match.groups.col, 10),
  };
}

function getOrderedSlots(
  vehicle: VehicleConfig | null,
  slots: Record<string, PalletData | null>,
): SlotMeta[] {
  const slotIds = getVehicleSlotIds(vehicle, slots);

  return slotIds
    .map((slotId) => {
      const config = vehicle?.payloadSlots[slotId];
      if (config) {
        return {
          id: slotId,
          row: config.row,
          col: config.col,
        };
      }

      return parseSlotMeta(slotId);
    })
    .filter((slot): slot is SlotMeta => slot !== null);
}

function getMaxRows(
  vehicle: VehicleConfig | null,
  orderedSlots: SlotMeta[],
): number {
  if (typeof vehicle?.maxRows === "number" && vehicle.maxRows > 0) {
    return vehicle.maxRows;
  }

  const maxRow = orderedSlots.reduce(
    (currentMax, slot) => Math.max(currentMax, slot.row),
    -1,
  );

  return maxRow + 1;
}

function sumUsedLdm(slots: Record<string, PalletData | null>): number {
  return Object.values(slots).reduce(
    (sum, pallet) => sum + (pallet?.ldm ?? 0),
    0,
  );
}

function sumUsedWeight(slots: Record<string, PalletData | null>): number {
  return Object.values(slots).reduce(
    (sum, pallet) => sum + (pallet?.weightKg ?? 0),
    0,
  );
}

function buildConflicts(
  slots: Record<string, PalletData | null>,
  vehicle: VehicleConfig | null,
): SlotConflict[] {
  const conflicts: SlotConflict[] = [];

  if (vehicle) {
    conflicts.push(...detectStackingViolations(slots, vehicle.payloadSlots));
    conflicts.push(...detectDimensionViolations(slots, vehicle.payloadSlots));
  }

  const totalWeight = sumUsedWeight(slots);
  if (vehicle && totalWeight > vehicle.maxWeightKg) {
    const occupiedSlotIds = Object.entries(slots)
      .filter(([, pallet]) => isPallet(pallet))
      .map(([slotId]) => slotId);

    conflicts.push({
      type: "weight_overload",
      affectedSlotIds: occupiedSlotIds,
      message: `Total payload weight ${totalWeight} kg exceeds vehicle limit ${vehicle.maxWeightKg} kg.`,
    });
  }

  const deliveryTime = toDate(vehicle?.deliveryTime ?? null);
  if (deliveryTime) {
    for (const [slotId, pallet] of Object.entries(slots)) {
      if (!pallet?.timeWindow) {
        continue;
      }

      const open = toDate(pallet.timeWindow.open);
      const close = toDate(pallet.timeWindow.close);
      if (!open || !close) {
        continue;
      }

      if (deliveryTime < open || deliveryTime > close) {
        conflicts.push({
          type: "time_window_breach",
          affectedSlotIds: [slotId],
          message: `Delivery time is outside the allowed window for ${slotId}.`,
        });
      }
    }
  }

  return conflicts;
}

function createClearedSlots(
  vehicle: VehicleConfig | null,
  slots: Record<string, PalletData | null>,
): Record<string, PalletData | null> {
  return Object.fromEntries(
    getVehicleSlotIds(vehicle, slots).map((slotId) => [slotId, null]),
  );
}

const loadStoreStorage = createJSONStorage<PersistedLoadStore>(
  () => (typeof window === "undefined" ? noopStorage : sessionStorage),
  {
    replacer: (_key, value) =>
      value instanceof Date ? value.toISOString() : value,
    reviver: (key, value) => {
      if (
        typeof value === "string" &&
        (key === "open" || key === "close" || key === "deliveryTime")
      ) {
        const parsed = toDate(value);
        return parsed ?? value;
      }

      return value;
    },
  },
);

export const useLoadStore = create<LoadStore>()(
  persist(
    (set) => ({
      slots: {},
      vehicle: null,
      sessionId: null,
      sessionOfferIds: [],
      assignPallet: (slotId, pallet) =>
        set((state) => ({
          slots: {
            ...state.slots,
            [slotId]: normalizePallet(pallet),
          },
        })),
      removePallet: (slotId) =>
        set((state) => ({
          slots: {
            ...state.slots,
            [slotId]: null,
          },
        })),
      swapSlots: (slotA, slotB) =>
        set((state) => {
          const palletA = state.slots[slotA] ?? null;
          const palletB = state.slots[slotB] ?? null;

          return {
            slots: {
              ...state.slots,
              [slotA]: palletB,
              [slotB]: palletA,
            },
          };
        }),
      clearAllSlots: () =>
        set((state) => ({
          slots: createClearedSlots(state.vehicle, state.slots),
        })),
      autoArrange: () =>
        set((state) => {
          const orderedSlots = getOrderedSlots(state.vehicle, state.slots);
          if (orderedSlots.length === 0) {
            return { slots: state.slots };
          }

          const maxRows = getMaxRows(state.vehicle, orderedSlots);
          const heavyRowStart = Math.floor(maxRows / 2);
          const lowerRows = orderedSlots.filter(
            (slot) => slot.row >= heavyRowStart,
          );
          const upperRows = orderedSlots.filter(
            (slot) => slot.row < heavyRowStart,
          );
          const sortedPallets = Object.values(state.slots)
            .filter(isPallet)
            .map(normalizePallet)
            .sort((a, b) => {
              if (!a.stackable && b.stackable) return -1;
              if (a.stackable && !b.stackable) return 1;
              if (a.weightKg > 500 && b.weightKg <= 500) return -1;
              if (a.weightKg <= 500 && b.weightKg > 500) return 1;
              return b.ldm - a.ldm;
            });

          const nextSlots = Object.fromEntries(
            orderedSlots.map((slot) => [slot.id, null]),
          ) as Record<string, PalletData | null>;

          let lowerIndex = 0;
          let upperIndex = 0;

          const takeSlot = (preferLowerRows: boolean): SlotMeta | undefined => {
            if (preferLowerRows) {
              return lowerRows[lowerIndex++] ?? upperRows[upperIndex++];
            }

            return upperRows[upperIndex++] ?? lowerRows[lowerIndex++];
          };

          sortedPallets.forEach((pallet) => {
            const slot = takeSlot(pallet.weightKg > 500);
            if (slot) {
              nextSlots[slot.id] = pallet;
            }
          });

          return { slots: nextSlots };
        }),
      setVehicle: (vehicle) =>
        set((state) => {
          const nextVehicle = normalizeVehicle(vehicle);
          const slotIds = getVehicleSlotIds(nextVehicle, state.slots);

          return {
            vehicle: nextVehicle,
            slots: Object.fromEntries(
              slotIds.map((slotId) => [slotId, state.slots[slotId] ?? null]),
            ) as Record<string, PalletData | null>,
          };
        }),
      setSessionId: (sessionId) => set({ sessionId }),
      setSessionOfferIds: (offerIds) => set({ sessionOfferIds: [...offerIds] }),
      applyBulkOffers: (offerIds) =>
        set((state) => {
          const nextIds = [...offerIds];
          const allowed = new Set(nextIds);
          const nextSlots = Object.fromEntries(
            Object.entries(state.slots).map(([slotId, pallet]) => [
              slotId,
              pallet && allowed.has(pallet.offerId) ? pallet : null,
            ]),
          ) as Record<string, PalletData | null>;

          return {
            sessionOfferIds: nextIds,
            slots: nextSlots,
          };
        }),
      setSlots: (slots) =>
        set(() => ({
          slots: normalizeSlots(slots),
        })),
      setLayout: (layout) =>
        set(() => ({
          slots: normalizeSlots(layout.slots),
          vehicle: layout.vehicle ? normalizeVehicle(layout.vehicle) : null,
          sessionId: layout.sessionId,
          sessionOfferIds: layout.sessionOfferIds ?? [],
        })),
    }),
    {
      name: "load-store",
      storage: loadStoreStorage,
      partialize: (state) => ({
        slots: state.slots,
        vehicle: state.vehicle,
        sessionId: state.sessionId,
        sessionOfferIds: state.sessionOfferIds,
      }),
    },
  ),
);

export const useUsedLdm = (): number => {
  const { slots } = useLoadStore(
    useShallow((state) => ({ slots: state.slots })),
  );
  return useMemo(() => sumUsedLdm(slots), [slots]);
};

export const useUsedWeight = (): number => {
  const { slots } = useLoadStore(
    useShallow((state) => ({ slots: state.slots })),
  );
  return useMemo(() => sumUsedWeight(slots), [slots]);
};

export const useClientSummary = (): ClientSummary[] => {
  const { slots } = useLoadStore(
    useShallow((state) => ({ slots: state.slots })),
  );

  return useMemo(() => {
    const clients = new Map<string, ClientSummary>();

    for (const pallet of Object.values(slots)) {
      if (!pallet) {
        continue;
      }

      const existing = clients.get(pallet.clientId);
      if (existing) {
        existing.ldm += pallet.ldm;
        existing.weight += pallet.weightKg;
        continue;
      }

      if (clients.size >= 12) {
        continue;
      }

      clients.set(pallet.clientId, {
        clientId: pallet.clientId,
        offerId: pallet.offerId,
        name: pallet.clientName,
        color: getCompanyColorPair(pallet.clientId || pallet.offerId).intense,
        ldm: pallet.ldm,
        weight: pallet.weightKg,
      });
    }

    return Array.from(clients.values());
  }, [slots]);
};

export const useConflicts = (): SlotConflict[] => {
  const { slots, vehicle } = useLoadStore(
    useShallow((state) => ({
      slots: state.slots,
      vehicle: state.vehicle,
    })),
  );

  return useMemo(() => buildConflicts(slots, vehicle), [slots, vehicle]);
};
