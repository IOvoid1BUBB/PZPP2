/** Heat-map stroke color from vehicle weight on a leg (ratio vs peak weight). */

const THRESHOLDS = [
  { maxRatio: 0.3, color: "#4E9AF1" },
  { maxRatio: 0.6, color: "#F5A623" },
  { maxRatio: 0.85, color: "#E8564A" },
  { maxRatio: Infinity, color: "#C0392B" },
] as const;

export function getLegColor(weightKg: number, maxWeightKg: number): string {
  if (maxWeightKg <= 0) {
    return THRESHOLDS[0].color;
  }
  const ratio = weightKg / maxWeightKg;
  for (const entry of THRESHOLDS) {
    if (ratio < entry.maxRatio) {
      return entry.color;
    }
  }
  return THRESHOLDS[THRESHOLDS.length - 1].color;
}

export function getMaxLegWeightKg(legs: { weightKgAtLeg: number }[]): number {
  if (legs.length === 0) {
    return 1;
  }
  return Math.max(...legs.map((leg) => leg.weightKgAtLeg), 1);
}

export const HEAT_MAP_LEGEND = [
  { label: "< 30% obciążenia", color: "#4E9AF1" },
  { label: "30–60%", color: "#F5A623" },
  { label: "60–85%", color: "#E8564A" },
  { label: "≥ 85%", color: "#C0392B" },
] as const;
