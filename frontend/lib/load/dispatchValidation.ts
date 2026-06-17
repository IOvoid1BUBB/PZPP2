/**
 * @file dispatchValidation.ts
 *
 * Walidacja biznesowa przed wysłaniem planu trasy do kierowcy
 * (PATCH /api/v1/sessions/{id}/status → "confirmed").
 *
 * Logika jest celowo czysta (bez zależności od React/store), aby mogła być
 * wywoływana z komponentu (SlotEditor / VehicleHeader) oraz pokryta testami
 * jednostkowymi niezależnie od warstwy UI.
 */

import type { SlotConflict } from "@/lib/types/load";

/** Komunikat błędu: na pace nie ma żadnego ładunku (usedLdm = 0). */
export const DISPATCH_EMPTY_TRAILER_MESSAGE = "Nie można wysłać: Pusta naczepa";

/** Komunikat błędu: występują nierozwiązane konflikty ułożenia ładunków. */
export const DISPATCH_CONFLICTS_MESSAGE =
  "Nie można wysłać: Rozwiąż konflikty załadunku";

export interface DispatchValidationInput {
  /** Aktywne konflikty ułożenia ładunków (ze store'a `useConflicts`). */
  conflicts: readonly SlotConflict[];
  /** Wykorzystane metry ładunkowe (LDM) — suma ze slotów (`useUsedLdm`). */
  usedLdm: number;
}

export interface DispatchValidationResult {
  /** `true`, gdy plan można bezpiecznie wysłać do kierowcy. */
  ok: boolean;
  /** Domenowy komunikat do wyświetlenia w Toast, gdy `ok === false`. */
  message?: string;
}

/**
 * Sprawdza, czy plan trasy spełnia warunki biznesowe wysyłki do kierowcy.
 *
 * Warunki (oba muszą być spełnione):
 *   1. `usedLdm > 0` — naczepa nie może być pusta.
 *   2. `conflicts.length === 0` — brak konfliktów ułożenia ładunków.
 *
 * Pusta naczepa jest sprawdzana jako pierwsza, ponieważ bez ładunku nie mogą
 * istnieć konflikty — dzięki temu komunikat jest zawsze najbardziej trafny.
 */
export function validateDispatch({
  conflicts,
  usedLdm,
}: DispatchValidationInput): DispatchValidationResult {
  if (!Number.isFinite(usedLdm) || usedLdm <= 0) {
    return { ok: false, message: DISPATCH_EMPTY_TRAILER_MESSAGE };
  }

  if (conflicts.length > 0) {
    return { ok: false, message: DISPATCH_CONFLICTS_MESSAGE };
  }

  return { ok: true };
}
