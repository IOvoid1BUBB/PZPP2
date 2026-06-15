/**
 * Lekki odpowiednik clsx — łączy klasy warunkowe bez zewnętrznych zależności.
 * Używany przez komponenty przeniesione z prototypu v0 (components/loadmax/*).
 */
export type ClassValue =
  | string
  | number
  | null
  | false
  | undefined
  | ClassValue[];

export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];

  const walk = (value: ClassValue): void => {
    if (!value && value !== 0) {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (typeof value === "string" || typeof value === "number") {
      out.push(String(value));
    }
  };

  inputs.forEach(walk);
  return out.join(" ");
}
