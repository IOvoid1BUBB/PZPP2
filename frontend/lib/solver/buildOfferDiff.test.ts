/**
 * buildOfferDiff.test.ts — Task 5.2 diff logic.
 *
 * Pokrycie: added / removed / unchanged, puste wejścia, deduplikacja,
 * determinizm kolejności i helper isEmptyDiff.
 */

import { describe, it, expect } from "vitest";

import { buildOfferDiff, isEmptyDiff } from "./buildOfferDiff";

describe("buildOfferDiff", () => {
  it("klasyfikuje oferty na added / removed / unchanged", () => {
    const current = ["a", "b", "c"];
    const selected = ["b", "c", "d"];

    const diff = buildOfferDiff(current, selected);

    expect(diff.added).toEqual(["d"]);
    expect(diff.removed).toEqual(["a"]);
    expect(diff.unchanged).toEqual(["b", "c"]);
  });

  it("zwraca tylko added gdy sesja była pusta", () => {
    const diff = buildOfferDiff([], ["x", "y"]);

    expect(diff.added).toEqual(["x", "y"]);
    expect(diff.removed).toEqual([]);
    expect(diff.unchanged).toEqual([]);
  });

  it("zwraca tylko removed gdy solver nic nie wybrał", () => {
    const diff = buildOfferDiff(["x", "y"], []);

    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual(["x", "y"]);
    expect(diff.unchanged).toEqual([]);
  });

  it("traktuje identyczne zbiory jako w całości unchanged", () => {
    const diff = buildOfferDiff(["a", "b"], ["a", "b"]);

    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.unchanged).toEqual(["a", "b"]);
  });

  it("zachowuje kolejność propozycji dla added/unchanged i sesji dla removed", () => {
    const current = ["c", "a", "z"];
    const selected = ["a", "n", "m"];

    const diff = buildOfferDiff(current, selected);

    expect(diff.unchanged).toEqual(["a"]);
    expect(diff.added).toEqual(["n", "m"]);
    expect(diff.removed).toEqual(["c", "z"]);
  });

  it("deduplikuje powtórzone identyfikatory na wejściu", () => {
    const diff = buildOfferDiff(["a", "a", "b"], ["b", "b", "d", "d"]);

    expect(diff.added).toEqual(["d"]);
    expect(diff.removed).toEqual(["a"]);
    expect(diff.unchanged).toEqual(["b"]);
  });

  it("obsługuje null/undefined jako puste wejścia", () => {
    expect(buildOfferDiff(null, null)).toEqual({
      added: [],
      removed: [],
      unchanged: [],
    });
    expect(buildOfferDiff(undefined, ["a"])).toEqual({
      added: ["a"],
      removed: [],
      unchanged: [],
    });
    expect(buildOfferDiff(["a"], undefined)).toEqual({
      added: [],
      removed: ["a"],
      unchanged: [],
    });
  });
});

describe("isEmptyDiff", () => {
  it("zwraca true tylko gdy wszystkie sekcje są puste", () => {
    expect(isEmptyDiff({ added: [], removed: [], unchanged: [] })).toBe(true);
    expect(isEmptyDiff({ added: ["a"], removed: [], unchanged: [] })).toBe(false);
    expect(isEmptyDiff({ added: [], removed: ["a"], unchanged: [] })).toBe(false);
    expect(isEmptyDiff({ added: [], removed: [], unchanged: ["a"] })).toBe(false);
  });
});
