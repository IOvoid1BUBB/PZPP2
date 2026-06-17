import { describe, expect, it } from "vitest";

import type { SlotConflict } from "@/lib/types/load";
import {
  DISPATCH_CONFLICTS_MESSAGE,
  DISPATCH_EMPTY_TRAILER_MESSAGE,
  validateDispatch,
} from "@/lib/load/dispatchValidation";

function makeConflict(overrides?: Partial<SlotConflict>): SlotConflict {
  return {
    type: "stacking_violation",
    affectedSlotIds: ["r0_c0", "r1_c0"],
    message: "Nieprawidłowe ułożenie palet.",
    ...overrides,
  };
}

describe("validateDispatch", () => {
  it("blokuje wysyłkę gdy naczepa jest pusta (usedLdm = 0)", () => {
    const result = validateDispatch({ conflicts: [], usedLdm: 0 });

    expect(result.ok).toBe(false);
    expect(result.message).toBe(DISPATCH_EMPTY_TRAILER_MESSAGE);
  });

  it("traktuje ujemny lub NaN usedLdm jako pustą naczepę", () => {
    expect(validateDispatch({ conflicts: [], usedLdm: -1 })).toEqual({
      ok: false,
      message: DISPATCH_EMPTY_TRAILER_MESSAGE,
    });
    expect(validateDispatch({ conflicts: [], usedLdm: Number.NaN })).toEqual({
      ok: false,
      message: DISPATCH_EMPTY_TRAILER_MESSAGE,
    });
  });

  it("blokuje wysyłkę gdy występują konflikty ułożenia", () => {
    const result = validateDispatch({
      conflicts: [makeConflict()],
      usedLdm: 4.2,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toBe(DISPATCH_CONFLICTS_MESSAGE);
  });

  it("priorytetyzuje komunikat o pustej naczepie nad konfliktami", () => {
    const result = validateDispatch({
      conflicts: [makeConflict()],
      usedLdm: 0,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toBe(DISPATCH_EMPTY_TRAILER_MESSAGE);
  });

  it("agreguje wiele konfliktów i nadal blokuje wysyłkę", () => {
    const result = validateDispatch({
      conflicts: [
        makeConflict({ type: "stacking_violation" }),
        makeConflict({ type: "weight_overload" }),
        makeConflict({ type: "time_window_breach" }),
      ],
      usedLdm: 10,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toBe(DISPATCH_CONFLICTS_MESSAGE);
  });

  it("przepuszcza wysyłkę gdy brak konfliktów i naczepa nie jest pusta", () => {
    const result = validateDispatch({ conflicts: [], usedLdm: 6.4 });

    expect(result).toEqual({ ok: true });
    expect(result.message).toBeUndefined();
  });

  it("akceptuje bardzo mały dodatni usedLdm", () => {
    const result = validateDispatch({ conflicts: [], usedLdm: 0.1 });

    expect(result.ok).toBe(true);
  });
});
