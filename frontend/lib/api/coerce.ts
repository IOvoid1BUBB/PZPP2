/** Coerce API values (Decimal → string in JSON) to finite numbers. */
export function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

export function toOptionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const parsed = toNumber(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : undefined;
}
