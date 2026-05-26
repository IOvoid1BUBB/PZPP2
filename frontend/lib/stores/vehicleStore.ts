"use client";

import { create } from "zustand";
import type { VehicleConfig } from "@/lib/types/load";
import { useLoadStore } from "@/lib/stores/loadStore";

// ─── Interface ─────────────────────────────────────────────────────────────

export interface VehicleStore {
  selectedVehicle: VehicleConfig | null;
  selectVehicle: (vehicle: VehicleConfig) => void;
}

export const useVehicleStore = create<VehicleStore>((set) => ({
  selectedVehicle: useLoadStore.getState().vehicle,
  selectVehicle: (vehicle) => {
    useLoadStore.getState().setVehicle(vehicle);
    set({ selectedVehicle: vehicle });
  },
}));

useLoadStore.subscribe((state, previousState) => {
  if (state.vehicle !== previousState.vehicle) {
    useVehicleStore.setState({ selectedVehicle: state.vehicle });
  }
});
