import { test, expect, type APIResponse } from "@playwright/test";

import { createSessionWithOffers, seedSession } from "./helpers";

/**
 * FEAT-11 — full consolidation flow:
 *   create session → simulate market → solver optimize → apply → confirm.
 *
 * Requires the stack to be running (docker compose up) and, in CI, the backend
 * started with USE_SOLVER_MOCK=true for a fast/deterministic solver.
 */

interface RawStop {
  offer_id?: string;
  stop_type?: string;
  pin_label?: string;
}

test.describe("Consolidation flow", () => {
  test("plans, optimizes and confirms a route", async ({ page, request }) => {
    // ── Step 1-2: create a draft session + simulated market via API ──────────
    const { sessionId } = await createSessionWithOffers(request, 50);
    await seedSession(page, sessionId);

    // ── Step 3: open the planner on the seeded session ───────────────────────
    await page.goto("/planner");

    // Offer library should be populated from the simulated market.
    await expect(page.getByTestId("offer-row").first()).toBeVisible({
      timeout: 30_000,
    });
    expect(await page.getByTestId("offer-row").count()).toBeGreaterThanOrEqual(1);

    // ── Step 4: reveal + run the solver ──────────────────────────────────────
    // The solver lives inside a collapsed <details>; expand it first.
    await page.getByText("Solver VRP", { exact: false }).first().click();

    // With an empty session, enable the full market so the solver has candidates.
    await page.getByLabel("Użyj pełnej giełdy").check();

    const optimizeBtn = page.getByTestId("solver-optimize-btn");
    await expect(optimizeBtn).toBeEnabled();
    await optimizeBtn.click();

    // ── Step 4 (cont.): wait for a solved status (OPTIMAL / FEASIBLE) ─────────
    await expect(page.getByText(/OPTIMAL|FEASIBLE/).first()).toBeVisible({
      timeout: 60_000,
    });

    // ── Step 5: the diff must show at least one added offer ───────────────────
    const addedRows = page.getByTestId("diff-added-row");
    await expect(addedRows.first()).toBeVisible();
    expect(await addedRows.count()).toBeGreaterThanOrEqual(1);

    // ── Step 6: apply the suggestion ─────────────────────────────────────────
    await page.getByTestId("solver-apply-btn").click();

    // ── Step 7: the trailer canvas must show occupied slots ──────────────────
    await expect(page.getByTestId("slot-occupied").first()).toBeVisible({
      timeout: 30_000,
    });
    expect(await page.getByTestId("slot-occupied").count()).toBeGreaterThanOrEqual(
      2,
    );

    // ── Step 8: precedence — every pickup precedes its delivery ──────────────
    const routeRes: APIResponse = await request.get(
      `/api/v1/sessions/${sessionId}/route-map`,
    );
    expect(routeRes.ok()).toBeTruthy();
    const routeMap = (await routeRes.json()) as { stops?: RawStop[] };
    const stops = routeMap.stops ?? [];

    const pickupIndex = new Map<string, number>();
    const deliveryIndex = new Map<string, number>();
    stops.forEach((stop, i) => {
      const offerId = stop.offer_id;
      if (!offerId) return;
      const isPickup =
        stop.stop_type === "pickup" || stop.pin_label?.startsWith("P");
      const isDelivery =
        stop.stop_type === "delivery" || stop.pin_label?.startsWith("D");
      if (isPickup && !pickupIndex.has(offerId)) pickupIndex.set(offerId, i);
      if (isDelivery && !deliveryIndex.has(offerId)) deliveryIndex.set(offerId, i);
    });

    for (const [offerId, pickupAt] of pickupIndex) {
      const deliveryAt = deliveryIndex.get(offerId);
      if (deliveryAt !== undefined) {
        expect(pickupAt, `pickup before delivery for ${offerId}`).toBeLessThan(
          deliveryAt,
        );
      }
    }

    // ── Step 9: analytics waterfall renders for the session ──────────────────
    await page.goto(`/analytics?session=${sessionId}`);
    await expect(page.getByTestId("waterfall-bar").first()).toBeVisible({
      timeout: 30_000,
    });
    expect(await page.getByTestId("waterfall-bar").count()).toBeGreaterThanOrEqual(
      4,
    );

    // ── Step 10: confirm the route → drag becomes disabled ───────────────────
    await page.goto("/planner");
    await expect(page.getByTestId("slot-occupied").first()).toBeVisible({
      timeout: 30_000,
    });

    await page.getByRole("button", { name: /Zatwierdź trasę/ }).click();

    // After confirmation the route is read-only: the confirmed badge appears and
    // no occupied slot exposes native draggable=true anymore.
    await expect(page.getByText(/Trasa zatwierdzona/).first()).toBeVisible({
      timeout: 30_000,
    });
    expect(
      await page.locator('[data-testid="slot-occupied"][draggable="true"]').count(),
    ).toBe(0);
  });
});
