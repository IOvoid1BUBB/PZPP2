export interface PalletDims {
  wMm: number;
  dMm: number;
  hMm: number;
}

export interface PalletTimeWindow {
  open: string | Date;
  close: string | Date;
}

export interface PalletData {
  id: string;
  offerId: string;
  clientId: string;
  clientName: string;
  clientColor: string;
  ldm: number;
  weightKg: number;
  dims: PalletDims;
  stackable: boolean;
  timeWindow: PalletTimeWindow | null;
}

export interface PayloadSlotConfig {
  row: number;
  col: number;
  ldmPerSlot: number;
  xOffsetCm: number;
  yOffsetCm: number;
}

export interface VehicleConfig {
  id: string;
  name: string;
  type: "bus_8" | "bus_9" | "bus_10" | "solo";
  maxLdm: number;
  maxWeightKg: number;
  trailerLengthCm: number;
  trailerWidthCm: number;
  payloadSlots: Record<string, PayloadSlotConfig>;
  deliveryTime?: string | Date | null;
  maxRows?: number;
  /** Maksymalna liczba przystanków — z API (GET /api/v1/vehicles) */
  maxStops?: number;
  /** Zużycie paliwa bazowe l/100 km — z API (GET /api/v1/vehicles) */
  fuelPer100kmBase?: number;
}

export type SlotConflictType =
  | "stacking_violation"
  | "time_window_breach"
  | "weight_overload";

export interface SlotConflict {
  type: SlotConflictType;
  affectedSlotIds: string[];
  message: string;
}

export interface LoadLayoutResponse {
  sessionId: string | null;
  vehicle: VehicleConfig;
  slots: Record<string, PalletData | null>;
  conflicts: SlotConflict[];
}

export interface ContextMenuItem {
  label: string;
  action: (slotId: string) => void;
  destructive?: boolean;
}
