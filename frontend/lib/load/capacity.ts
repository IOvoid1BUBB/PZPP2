import type { PalletData, SlotConflict, VehicleConfig } from "@/lib/types/load";

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

  const usedLdm = getUsedLdm(slots);
  const usedWeight = getUsedWeight(slots);
  return usedLdm <= vehicle.maxLdm && usedWeight <= vehicle.maxWeightKg;
}

export function getConflictSlotIds(conflicts: SlotConflict[]): Set<string> {
  return new Set(conflicts.flatMap((conflict) => conflict.affectedSlotIds));
}
