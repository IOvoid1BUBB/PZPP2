/**
 * @file loadStore.ts
 * @task Task 2.2 — useLoadStore (Zustand)
 *
 * TODO: Zaimplementuj store używając Zustand `create()`.
 *
 * Wymagane API:
 *   slots         : Record<string, PalletData | null>
 *   clearAllSlots : () => void
 *
 * Przykładowa implementacja Zustand:
 *
 *   import { create } from "zustand";
 *   export const useLoadStore = create<LoadStore>((set) => ({
 *     slots: {},
 *     clearAllSlots: () => set({ slots: {} }),
 *   }));
 *
 * Uwaga: SlotEditor nadal używa hooks/usePlannerLayout.ts + /api/v1/planner/*.
 * Migracja SlotEditor → useLoadStore jest osobnym zadaniem (nie rób tego tutaj).
 */

export type {
  ContextMenuItem,
  LoadLayoutResponse,
  PalletData,
  SlotConflict,
  VehicleConfig,
} from "@/lib/types/load";

import type { PalletData } from "@/lib/types/load";

// ─── Interface ──────────────────────────────────────────────────────────────

export interface LoadStore {
  /** Mapa slotów ładunku: klucz = slotId, wartość = PalletData lub null (pusty slot) */
  slots: Record<string, PalletData | null>;
  /** Wyczyść wszystkie sloty (wywołaj przy zmianie pojazdu w VehicleSelector) */
  clearAllSlots: () => void;
}

// ─── Stub hook ──────────────────────────────────────────────────────────────
// Tymczasowy stub — nie modyfikuj sygnatury. Zastąp implementacją Zustand.

/** @todo Zastąp implementacją Zustand create<LoadStore>() */
export function useLoadStore(): LoadStore {
  return {
    slots: {},
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    clearAllSlots: () => {},
  };
}

