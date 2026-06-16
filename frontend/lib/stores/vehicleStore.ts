"use client";

import { create } from "zustand";
import type { VehicleConfig } from "@/lib/types/load";
import { useLoadStore } from "@/lib/stores/loadStore";
import type { SessionOrigin } from "@/lib/fleet/resolveSessionOrigin";

// ─── Interface ─────────────────────────────────────────────────────────────

export interface VehicleStore {
  selectedVehicle: VehicleConfig | null;
  /** Route start point — typically the fleet vehicle home base. */
  sessionOrigin: SessionOrigin | null;
  fleetVehicleId: string | null;
  selectVehicle: (
    vehicle: VehicleConfig,
    context?: { origin?: SessionOrigin; fleetVehicleId?: string },
  ) => void;
  setSessionContext: (context: {
    origin: SessionOrigin;
    fleetVehicleId?: string | null;
  }) => void;
}

export const useVehicleStore = create<VehicleStore>((set) => ({
  selectedVehicle: useLoadStore.getState().vehicle,
  sessionOrigin: null,
  fleetVehicleId: null,
  selectVehicle: (vehicle, context) => {
    useLoadStore.getState().setVehicle(vehicle);
    set({
      selectedVehicle: vehicle,
      sessionOrigin: context?.origin ?? null,
      fleetVehicleId: context?.fleetVehicleId ?? null,
    });
  },
  setSessionContext: ({ origin, fleetVehicleId }) =>
    set({
      sessionOrigin: origin,
      fleetVehicleId: fleetVehicleId ?? null,
    }),
}));

useLoadStore.subscribe((state, previousState) => {
  if (state.vehicle !== previousState.vehicle) {
    useVehicleStore.setState({ selectedVehicle: state.vehicle });
  }
});
