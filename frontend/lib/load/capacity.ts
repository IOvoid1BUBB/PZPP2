import type {
  PalletData,
  PalletDims,
  PayloadSlotConfig,
  SlotConflict,
  VehicleConfig,
} from "@/lib/types/load";
function toSlotConfig(entry: Record<string, unknown>): PayloadSlotConfig {
  return {
    row: Number(entry.row ?? 0),
    col: Number(entry.col ?? 0),
    // 1 slot = 1 paleta EUR = 0.4 LDM
    ldmPerSlot: Number(entry.ldm_per_slot ?? entry.ldmPerSlot ?? 0.4),
    xOffsetCm: Number(entry.x_offset_cm ?? entry.xOffsetCm ?? 0),
    yOffsetCm: Number(entry.y_offset_cm ?? entry.yOffsetCm ?? 0),
    widthCm: Number(entry.width_cm ?? entry.widthCm ?? 80),
    depthCm: Number(entry.depth_cm ?? entry.depthCm ?? 120),
  };
}

/**
 * Normalize `payload_slots` shapes coming from various API endpoints:
 *  - `{ slots: [...], total_ldm: N }` — raw seed dump (`/api/v1/vehicles`)
 *  - `{ slotId: { ...camelCase } }` — already-normalized planner endpoint
 *  - `{ slotId: { ...snake_case } }` — defensive
 */
export function normalizePayloadSlots(raw: unknown): Record<string, PayloadSlotConfig> {
  if (!raw || typeof raw !== "object") {
    return {};
  }

  const obj = raw as Record<string, unknown>;
  const result: Record<string, PayloadSlotConfig> = {};

  if (Array.isArray(obj.slots)) {
    for (const entry of obj.slots as Array<Record<string, unknown>>) {
      if (!entry || typeof entry !== "object") continue;
      const slotId = entry.id ? String(entry.id) : null;
      if (!slotId) continue;
      result[slotId] = toSlotConfig(entry);
    }
    return repairOverlappingSlots(result);
  }

  for (const [slotId, entry] of Object.entries(obj)) {
    if (!entry || typeof entry !== "object") continue;
    result[slotId] = toSlotConfig(entry as Record<string, unknown>);
  }
  return repairOverlappingSlots(result);
}

/**
 * Shift right-column longitudinal slots that overlap a wider left-column
 * transverse slot.  E.g. a left slot at x=0, w=120 extends to x=120;
 * a right slot at x=80, w=80 overlaps in [80,120).  Move it to x=120.
 */
function repairOverlappingSlots(
  slots: Record<string, PayloadSlotConfig>,
): Record<string, PayloadSlotConfig> {
  const entries = Object.entries(slots);
  let patched = false;
  const fixed = { ...slots };

  for (const [id, cfg] of entries) {
    const w = cfg.widthCm ?? 80;
    const d = cfg.depthCm ?? 120;
    if (cfg.xOffsetCm === 0 || w >= 100) continue;

    const yStart = cfg.yOffsetCm;
    const yEnd = yStart + d;

    for (const [, other] of entries) {
      if (other.xOffsetCm !== 0) continue;
      const ow = other.widthCm ?? 80;
      if (ow <= cfg.xOffsetCm) continue;
      const oyStart = other.yOffsetCm;
      const oyEnd = oyStart + (other.depthCm ?? 120);

      if (yStart < oyEnd && yEnd > oyStart && cfg.xOffsetCm < ow) {
        fixed[id] = { ...cfg, xOffsetCm: ow };
        patched = true;
        break;
      }
    }
  }

  return patched ? fixed : slots;
}

export function getUsedLdm(slots: Record<string, PalletData | null>): number {
  return Object.values(slots)
    .filter((pallet): pallet is PalletData => pallet !== null)
    .reduce((sum, pallet) => sum + pallet.ldm, 0);
}

export function getUsedWeight(slots: Record<string, PalletData | null>): number {
  return Object.values(slots)
    .filter((pallet): pallet is PalletData => pallet !== null)
    .reduce((sum, pallet) => sum + pallet.weightKg, 0);
}

function hasOccupiedFootprintOverlap(
  targetSlotId: string,
  slots: Record<string, PalletData | null>,
  payloadSlots: Record<string, PayloadSlotConfig>,
  excludeSlotIds: string[] = [],
): boolean {
  const targetConfig = payloadSlots[targetSlotId];
  if (!targetConfig) {
    return false;
  }

  const excluded = new Set([targetSlotId, ...excludeSlotIds]);

  for (const [slotId, pallet] of Object.entries(slots)) {
    if (!pallet || excluded.has(slotId)) {
      continue;
    }
    const otherConfig = payloadSlots[slotId];
    if (otherConfig && slotFootprintsOverlap(targetConfig, otherConfig)) {
      return true;
    }
  }

  return false;
}

/** Interlocking slots (e.g. L4 s3/s8) share floor space — no moves between them. */
function sourceTargetFootprintsOverlap(
  sourceSlotId: string | undefined,
  targetSlotId: string,
  payloadSlots: Record<string, PayloadSlotConfig>,
): boolean {
  if (!sourceSlotId) {
    return false;
  }

  const sourceConfig = payloadSlots[sourceSlotId];
  const targetConfig = payloadSlots[targetSlotId];
  if (!sourceConfig || !targetConfig) {
    return false;
  }

  return slotFootprintsOverlap(sourceConfig, targetConfig);
}

export function canAssign(
  slots: Record<string, PalletData | null>,
  vehicle: VehicleConfig | null,
  pallet: PalletData,
  targetSlotId: string,
  sourceSlotId?: string,
): boolean {
  if (!vehicle || !(targetSlotId in vehicle.payloadSlots)) {
    return false;
  }

  if (slots[targetSlotId] !== null && slots[targetSlotId] !== undefined) {
    return false;
  }

  if (
    sourceTargetFootprintsOverlap(sourceSlotId, targetSlotId, vehicle.payloadSlots)
  ) {
    return false;
  }

  if (
    hasOccupiedFootprintOverlap(
      targetSlotId,
      slots,
      vehicle.payloadSlots,
      sourceSlotId ? [sourceSlotId] : [],
    )
  ) {
    return false;
  }

  const targetConfig = vehicle.payloadSlots[targetSlotId];
  if (!targetConfig || !palletFitsSlot(pallet, targetConfig)) {
    return false;
  }

  let usedLdm = getUsedLdm(slots);
  let usedWeight = getUsedWeight(slots);

  if (sourceSlotId && slots[sourceSlotId]) {
    usedLdm -= slots[sourceSlotId]!.ldm;
    usedWeight -= slots[sourceSlotId]!.weightKg;
  }

  return (
    usedLdm + pallet.ldm <= vehicle.maxLdm &&
    usedWeight + pallet.weightKg <= vehicle.maxWeightKg
  );
}

export function canSwap(
  slots: Record<string, PalletData | null>,
  vehicle: VehicleConfig | null,
  slotA: string,
  slotB: string,
): boolean {
  if (!vehicle) {
    return false;
  }

  const palletA = slots[slotA];
  const palletB = slots[slotB];
  if (!palletA || !palletB) {
    return false;
  }

  const configA = vehicle.payloadSlots[slotA];
  const configB = vehicle.payloadSlots[slotB];
  if (!configA || !configB) {
    return false;
  }

  if (!palletFitsSlot(palletA, configB) || !palletFitsSlot(palletB, configA)) {
    return false;
  }

  if (slotFootprintsOverlap(configA, configB)) {
    return false;
  }

  for (const [slotId, pallet] of Object.entries(slots)) {
    if (!pallet || slotId === slotA || slotId === slotB) {
      continue;
    }
    const otherConfig = vehicle.payloadSlots[slotId];
    if (!otherConfig) {
      continue;
    }
    if (
      slotFootprintsOverlap(configA, otherConfig) ||
      slotFootprintsOverlap(configB, otherConfig)
    ) {
      return false;
    }
  }

  const usedLdm = getUsedLdm(slots);
  const usedWeight = getUsedWeight(slots);
  return usedLdm <= vehicle.maxLdm && usedWeight <= vehicle.maxWeightKg;
}

export function assignBlockedByFootprint(
  slots: Record<string, PalletData | null>,
  vehicle: VehicleConfig | null,
  targetSlotId: string,
  sourceSlotId?: string,
): boolean {
  if (!vehicle) {
    return false;
  }

  if (sourceTargetFootprintsOverlap(sourceSlotId, targetSlotId, vehicle.payloadSlots)) {
    return true;
  }

  return hasOccupiedFootprintOverlap(
    targetSlotId,
    slots,
    vehicle.payloadSlots,
    sourceSlotId ? [sourceSlotId] : [],
  );
}

/** True when persisted vehicle slot geometry looks outdated (pre width/depth or pre non-overlap fix). */
export function payloadSlotsGeometryStale(vehicle: VehicleConfig | null): boolean {
  if (!vehicle) {
    return false;
  }

  if (vehicle.type === "master_l2") {
    const s3 = vehicle.payloadSlots.s3;
    return s3 !== undefined && (s3.widthCm ?? DEFAULT_SLOT_WIDTH_CM) < 120;
  }

  if (vehicle.type === "master_l4") {
    const s2 = vehicle.payloadSlots.s2;
    const s3 = vehicle.payloadSlots.s3;
    const s8 = vehicle.payloadSlots.s8;
    return (
      (s2 !== undefined && (s2.widthCm ?? DEFAULT_SLOT_WIDTH_CM) < 120) ||
      (s3 !== undefined && (s3.widthCm ?? DEFAULT_SLOT_WIDTH_CM) < 120) ||
      (s8 !== undefined && s8.xOffsetCm < 120)
    );
  }

  if (vehicle.type === "master_l3") {
    const s2 = vehicle.payloadSlots.s2;
    const s7 = vehicle.payloadSlots.s7;
    return (
      (s2 !== undefined && (s2.widthCm ?? DEFAULT_SLOT_WIDTH_CM) < 120) ||
      (s7 !== undefined && s7.xOffsetCm < 120)
    );
  }

  return false;
}

export function assignBlockedBySize(
  pallet: PalletData,
  vehicle: VehicleConfig | null,
  targetSlotId: string,
): boolean {
  if (!vehicle) {
    return false;
  }

  const targetConfig = vehicle.payloadSlots[targetSlotId];
  if (!targetConfig) {
    return false;
  }

  return !palletFitsSlot(pallet, targetConfig);
}

/** First empty slot where the pallet passes all assignment rules. */
export function findFirstAssignableSlot(
  slots: Record<string, PalletData | null>,
  vehicle: VehicleConfig | null,
  pallet: PalletData,
  sourceSlotId: string,
): string | null {
  if (!vehicle) {
    return null;
  }

  for (const [slotId, value] of Object.entries(slots)) {
    if (slotId === sourceSlotId || value !== null) {
      continue;
    }
    if (canAssign(slots, vehicle, pallet, slotId, sourceSlotId)) {
      return slotId;
    }
  }

  return null;
}

export function getConflictSlotIds(conflicts: SlotConflict[]): Set<string> {
  return new Set(conflicts.flatMap((conflict) => conflict.affectedSlotIds));
}

const DEFAULT_PALLET_W_MM = 800;
const DEFAULT_PALLET_D_MM = 1200;
const DEFAULT_SLOT_WIDTH_CM = 80;
const DEFAULT_SLOT_DEPTH_CM = 120;

/** Resolve a slot's footprint, defaulting right-column slots to transverse EUR dims. */
export function effectiveSlotFootprintCm(config: PayloadSlotConfig): {
  widthCm: number;
  depthCm: number;
} {
  if (config.widthCm !== undefined && config.depthCm !== undefined) {
    return { widthCm: config.widthCm, depthCm: config.depthCm };
  }
  if (config.col >= 1) {
    return { widthCm: 120, depthCm: 80 };
  }
  return { widthCm: DEFAULT_SLOT_WIDTH_CM, depthCm: DEFAULT_SLOT_DEPTH_CM };
}

function palletFootprintMm(pallet: PalletData): { wMm: number; dMm: number } {
  const normalized = normalizePalletDims(pallet);
  return {
    wMm: normalized.dims.wMm,
    dMm: normalized.dims.dMm,
  };
}

/** Euro pallet may be placed with a 90° turn when it fits the slot footprint. */
export function palletFitsSlot(pallet: PalletData, slot: PayloadSlotConfig): boolean {
  const { wMm, dMm } = palletFootprintMm(pallet);
  const slotWMm = (slot.widthCm ?? DEFAULT_SLOT_WIDTH_CM) * 10;
  const slotDMm = (slot.depthCm ?? DEFAULT_SLOT_DEPTH_CM) * 10;
  const fitsAsIs = wMm <= slotWMm && dMm <= slotDMm;
  const fitsRotated = wMm <= slotDMm && dMm <= slotWMm;
  return fitsAsIs || fitsRotated;
}

/** Align stored pallet dims to the target slot orientation (auto 90° when needed). */
export function orientPalletForSlot(pallet: PalletData, slot: PayloadSlotConfig): PalletData {
  const { wMm, dMm } = palletFootprintMm(pallet);
  const slotWMm = (slot.widthCm ?? DEFAULT_SLOT_WIDTH_CM) * 10;
  const slotDMm = (slot.depthCm ?? DEFAULT_SLOT_DEPTH_CM) * 10;
  const fitsAsIs = wMm <= slotWMm && dMm <= slotDMm;
  const fitsRotated = wMm <= slotDMm && dMm <= slotWMm;

  if (!fitsAsIs && !fitsRotated) {
    return pallet;
  }

  if (wMm === slotWMm && dMm === slotDMm) {
    return pallet;
  }

  return {
    ...pallet,
    dims: {
      ...pallet.dims,
      wMm: slotWMm,
      dMm: slotDMm,
      hMm: pallet.dims?.hMm ?? 1600,
    },
  };
}

export function normalizePalletDims(pallet: PalletData): PalletData {
  const raw = pallet.dims as PalletDims & { w_mm?: number; d_mm?: number; h_mm?: number };
  const wMm = Number(raw.wMm ?? raw.w_mm ?? DEFAULT_PALLET_W_MM);
  const dMm = Number(raw.dMm ?? raw.d_mm ?? DEFAULT_PALLET_D_MM);
  const hMm = Number(raw.hMm ?? raw.h_mm ?? 1600);

  if (wMm === raw.wMm && dMm === raw.dMm && hMm === raw.hMm) {
    return pallet;
  }

  return {
    ...pallet,
    dims: { wMm, dMm, hMm },
  };
}

function slotBounds(config: PayloadSlotConfig) {
  const width = config.widthCm ?? DEFAULT_SLOT_WIDTH_CM;
  const depth = config.depthCm ?? DEFAULT_SLOT_DEPTH_CM;
  return {
    left: config.xOffsetCm,
    top: config.yOffsetCm,
    right: config.xOffsetCm + width,
    bottom: config.yOffsetCm + depth,
  };
}

/** True when two slot footprints share floor area (vertical stack), not merely same lane. */
export function slotFootprintsOverlap(a: PayloadSlotConfig, b: PayloadSlotConfig): boolean {
  const boxA = slotBounds(a);
  const boxB = slotBounds(b);
  return !(
    boxA.right <= boxB.left ||
    boxB.right <= boxA.left ||
    boxA.bottom <= boxB.top ||
    boxB.bottom <= boxA.top
  );
}

export function detectStackingViolations(
  slots: Record<string, PalletData | null>,
  payloadSlots: Record<string, PayloadSlotConfig>,
): SlotConflict[] {
  const conflicts: SlotConflict[] = [];
  const slotIds = Object.keys(payloadSlots);

  for (let i = 0; i < slotIds.length; i += 1) {
    for (let j = i + 1; j < slotIds.length; j += 1) {
      const slotA = slotIds[i]!;
      const slotB = slotIds[j]!;
      const palletA = slots[slotA];
      const palletB = slots[slotB];
      if (!palletA || !palletB) {
        continue;
      }

      const configA = payloadSlots[slotA];
      const configB = payloadSlots[slotB];
      if (!configA || !configB || !slotFootprintsOverlap(configA, configB)) {
        continue;
      }

      if (!palletA.stackable || !palletB.stackable) {
        conflicts.push({
          type: "stacking_violation",
          affectedSlotIds: [slotA, slotB],
          message:
            "Niedozwolone stackowanie: co najmniej jedna paleta w tym miejscu jest niestackowalna.",
        });
        continue;
      }

      conflicts.push({
        type: "footprint_overlap",
        affectedSlotIds: [slotA, slotB],
        message: "Dwa ładunki nie mogą zajmować tego samego miejsca na podłodze.",
      });
    }
  }

  return conflicts;
}

export function detectDimensionViolations(
  slots: Record<string, PalletData | null>,
  payloadSlots: Record<string, PayloadSlotConfig>,
): SlotConflict[] {
  const conflicts: SlotConflict[] = [];

  for (const [slotId, pallet] of Object.entries(slots)) {
    if (!pallet) {
      continue;
    }
    const config = payloadSlots[slotId];
    if (!config || palletFitsSlot(pallet, config)) {
      continue;
    }

    conflicts.push({
      type: "dimension_mismatch",
      affectedSlotIds: [slotId],
      message: `Paleta ${pallet.clientName} nie mieści się w slocie ${slotId}.`,
    });
  }

  return conflicts;
}
