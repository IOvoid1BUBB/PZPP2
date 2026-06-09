import type { DriverProfileRecord } from "@/lib/api/sessionClient";
import type { VehicleConfig } from "@/lib/types/load";
import { fetchDriverProfiles, fetchVehicles } from "@/lib/api/sessionClient";

export interface FleetOverview {
  vehicles: VehicleConfig[];
  driverProfiles: DriverProfileRecord[];
}

export async function fetchFleetOverview(): Promise<FleetOverview> {
  const [vehicles, driverProfiles] = await Promise.all([
    fetchVehicles(),
    fetchDriverProfiles(),
  ]);
  return { vehicles, driverProfiles };
}
