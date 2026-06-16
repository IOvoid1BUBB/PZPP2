/**
 * @file buildOfferDiff.ts
 *
 * Pure helper that diffs the offers currently assigned to a session against the
 * offers proposed by the VRP solver. Extracted from the SolverPanel so the diff
 * logic can be unit-tested in isolation (Task 5.2).
 *
 * Sekcje:
 *   - added     — w propozycji solvera, brak w aktualnej sesji
 *   - removed   — w aktualnej sesji, brak w propozycji
 *   - unchanged — w obu (utrzymane przez solver)
 *
 * Porównanie odbywa się po UUID oferty. Wejście jest deduplikowane, a kolejność
 * wynikowa jest deterministyczna (added/unchanged wg kolejności propozycji,
 * removed wg kolejności sesji).
 */

import type { UUID } from "@/lib/types/solver";

export interface OfferDiff {
  added: UUID[];
  removed: UUID[];
  unchanged: UUID[];
}

const EMPTY_DIFF: OfferDiff = { added: [], removed: [], unchanged: [] };

/**
 * Build the added/removed/unchanged diff between the session's current offers
 * and the solver's selected offers.
 *
 * @param currentOfferIds  Offers currently attached to the session.
 * @param selectedOfferIds Offers chosen by the solver.
 */
export function buildOfferDiff(
  currentOfferIds: readonly UUID[] | null | undefined,
  selectedOfferIds: readonly UUID[] | null | undefined,
): OfferDiff {
  if (!currentOfferIds && !selectedOfferIds) {
    return { ...EMPTY_DIFF };
  }

  // Set keeps insertion order, so spreading preserves caller order while
  // collapsing accidental duplicates into a single row.
  const before = new Set(currentOfferIds ?? []);
  const after = new Set(selectedOfferIds ?? []);

  const added = [...after].filter((id) => !before.has(id));
  const removed = [...before].filter((id) => !after.has(id));
  const unchanged = [...after].filter((id) => before.has(id));

  return { added, removed, unchanged };
}

/** True when the diff contains no rows at all. */
export function isEmptyDiff(diff: OfferDiff): boolean {
  return (
    diff.added.length === 0 &&
    diff.removed.length === 0 &&
    diff.unchanged.length === 0
  );
}
