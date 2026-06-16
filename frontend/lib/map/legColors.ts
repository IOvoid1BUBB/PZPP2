/** Heat-map stroke color from a leg's load ratio (cargo / vehicle max weight). */

const THRESHOLDS = [
  { maxRatio: 0.3, color: "#4E9AF1" },
  { maxRatio: 0.6, color: "#F5A623" },
  { maxRatio: 0.85, color: "#E8564A" },
  { maxRatio: Infinity, color: "#C0392B" },
] as const;

/** Map a 0..1 load ratio to a heat-map color. */
export function getLegColorByRatio(loadRatio: number): string {
  const ratio = Number.isFinite(loadRatio) ? Math.max(0, loadRatio) : 0;
  for (const entry of THRESHOLDS) {
    if (ratio < entry.maxRatio) {
      return entry.color;
    }
  }
  return THRESHOLDS[THRESHOLDS.length - 1].color;
}

/**
 * Resolve a leg's heat-map color.
 *
 * Prefers the backend-provided `loadRatio` — already computed as
 * `max(weight / max_weight, ldm / max_ldm)`. A ratio of `0` is a valid value
 * (empty leg) and must be honored, so we only fall back when it is missing.
 * The fallback uses `weightKg / maxWeightKg` for older payloads or demo data.
 */
export function getLegColor(
  weightKg: number,
  maxWeightKg: number,
  loadRatio?: number,
): string {
  if (loadRatio != null) {
    return getLegColorByRatio(loadRatio);
  }
  if (maxWeightKg <= 0) {
    return THRESHOLDS[0].color;
  }
  return getLegColorByRatio(weightKg / maxWeightKg);
}

export function getMaxLegWeightKg(legs: { weightKgAtLeg: number }[]): number {
  if (legs.length === 0) {
    return 1;
  }
  return Math.max(...legs.map((leg) => leg.weightKgAtLeg), 1);
}

export const HEAT_MAP_LEGEND = [
  { label: "< 30% pojemności", color: "#4E9AF1" },
  { label: "30–60% pojemności", color: "#F5A623" },
  { label: "60–85% pojemności", color: "#E8564A" },
  { label: "≥ 85% pojemności", color: "#C0392B" },
] as const;
