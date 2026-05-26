/**
 * @file vehicleStore.ts
 * @task Task 1.4 — useVehicleStore (Zustand)
 *
 * TODO: Zaimplementuj store używając Zustand `create()`.
 *
 * Wymagane API:
 *   selectedVehicle : VehicleConfig | null
 *   selectVehicle   : (vehicle: VehicleConfig) => void
 *
 * Przykładowa implementacja Zustand:
 *
 *   import { create } from "zustand";
 *   export const useVehicleStore = create<VehicleStore>((set) => ({
 *     selectedVehicle: null,
 *     selectVehicle: (vehicle) => set({ selectedVehicle: vehicle }),
 *   }));
 *
 * Opcjonalnie dodaj middleware devtools:
 *   import { devtools } from "zustand/middleware";
 *   create<VehicleStore>()(devtools(..., { name: "vehicleStore" }))
 */

import type { VehicleConfig } from "@/lib/types/load";

// ─── Interface ─────────────────────────────────────────────────────────────

export interface VehicleStore {
  /** Aktualnie wybrany pojazd (null = żaden nie wybrany) */
  selectedVehicle: VehicleConfig | null;
  /** Ustaw wybrany pojazd i zapisz w store */
  selectVehicle: (vehicle: VehicleConfig) => void;
}

// ─── Stub hook ──────────────────────────────────────────────────────────────
// Tymczasowy stub — nie modyfikuj sygnatury. Zastąp implementacją Zustand.

let _selectedVehicle: VehicleConfig | null = null;

/** @todo Zastąp implementacją Zustand create<VehicleStore>() */
export function useVehicleStore(): VehicleStore {
  return {
    selectedVehicle: _selectedVehicle,
    selectVehicle: (vehicle) => {
      _selectedVehicle = vehicle;
    },
  };
}
