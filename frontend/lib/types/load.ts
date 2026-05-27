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
  /** Footprint width across the bed (cm). Default 80 — euro pallet longitudinal. */
  widthCm?: number;
  /** Footprint depth along the bed (cm). Default 120 — euro pallet longitudinal. */
  depthCm?: number;
}

export interface VehicleConfig {
  id: string;
  name: string;
  type: "master_l2" | "master_l3" | "master_l4" | "man_solo";
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
  | "footprint_overlap"
  | "dimension_mismatch"
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
