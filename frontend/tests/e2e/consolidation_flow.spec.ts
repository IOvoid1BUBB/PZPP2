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
  sequence_order?: number;
  pin_label?: string;
}

test.describe("Consolidation flow", () => {
  test("plans, optimizes and confirms a route", async ({ page, request }) => {
    // ── Step 1: pick the vehicle (Solówka) and verify its stop limit ─────────
    // Fresh session → no seeded store yet, so the VehicleSelector is shown.
    await page.goto("/planner");
    const soloCard = page.locator("#vehicle-card-man_solo");
    await expect(soloCard).toBeVisible({ timeout: 30_000 });
    // MAN Solówka allows up to 10 stops (vs 6 for the Master vans).
    await expect(soloCard).toContainText("max 10 przystanków");
    await soloCard.click();

    // ── Step 2: create a draft session + 50 simulated offers via the API ─────
    const { sessionId } = await createSessionWithOffers(request, 50);
    await seedSession(page, sessionId);

    // ── Step 3: open the planner on the seeded session ───────────────────────
    await page.goto("/planner");

    // Offer library should be populated from the simulated market (≥10 rows).
    await expect(page.getByTestId("offer-row").first()).toBeVisible({
      timeout: 30_000,
    });
    expect(await page.getByTestId("offer-row").count()).toBeGreaterThanOrEqual(10);

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
    // Assert directly on the stop `sequence_order` (the route-stop ordering
    // field): for every offer, pickup.sequence_order < delivery.sequence_order.
    const routeRes: APIResponse = await request.get(
      `/api/v1/sessions/${sessionId}/route-map`,
    );
    expect(routeRes.ok()).toBeTruthy();
    const routeMap = (await routeRes.json()) as { stops?: RawStop[] };
    const stops = routeMap.stops ?? [];
    expect(stops.length).toBeGreaterThanOrEqual(2);

    const pickupOrder = new Map<string, number>();
    const deliveryOrder = new Map<string, number>();
    stops.forEach((stop, i) => {
      const offerId = stop.offer_id;
      if (!offerId) return;
      // Prefer the explicit sequence_order; fall back to array index.
      const order = stop.sequence_order ?? i;
      const isPickup =
        stop.stop_type === "pickup" || stop.pin_label?.startsWith("P");
      const isDelivery =
        stop.stop_type === "delivery" || stop.pin_label?.startsWith("D");
      if (isPickup && !pickupOrder.has(offerId)) pickupOrder.set(offerId, order);
      if (isDelivery && !deliveryOrder.has(offerId))
        deliveryOrder.set(offerId, order);
    });

    let precedenceViolations = 0;
    for (const [offerId, pickupAt] of pickupOrder) {
      const deliveryAt = deliveryOrder.get(offerId);
      if (deliveryAt !== undefined && !(pickupAt < deliveryAt)) {
        precedenceViolations += 1;
      }
      if (deliveryAt !== undefined) {
        expect(
          pickupAt,
          `pickup must precede delivery for offer ${offerId}`,
        ).toBeLessThan(deliveryAt);
      }
    }
    // Hard requirement: zero precedence-constraint violations.
    expect(precedenceViolations).toBe(0);

    // ── Step 9: analytics waterfall — 7 bars incl. the stop-costs bar ────────
    await page.goto(`/analytics?session=${sessionId}`);
    await expect(page.getByTestId("waterfall-bar").first()).toBeVisible({
      timeout: 30_000,
    });
    // With ≥2 stops the waterfall has 7 bars: Przychód, Paliwo, Myto,
    // Przystanki, Kierowca, Serwis, Zysk netto.
    expect(await page.getByTestId("waterfall-bar").count()).toBe(7);
    // The "Przystanki" (stop costs) bar must be present.
    await expect(
      page.locator('[data-testid="waterfall-bar"][data-bar-key="stops"]'),
    ).toHaveCount(1);

    // ── Step 10: confirm the route → drag becomes disabled ───────────────────
    await page.goto("/planner");
    await expect(page.getByTestId("slot-occupied").first()).toBeVisible({
      timeout: 30_000,
    });

    await page.getByRole("button", { name: /Zatwierdź trasę/ }).click();

    // After confirmation the route is read-only: the confirmed badge appears…
    await expect(page.getByText(/Trasa zatwierdzona/).first()).toBeVisible({
      timeout: 30_000,
    });

    // …drag is explicitly disabled (draggable="false") on every occupied slot…
    const occupied = page.locator('[data-testid="slot-occupied"]');
    await expect(occupied.first()).toBeVisible({ timeout: 30_000 });
    expect(
      await page.locator('[data-testid="slot-occupied"][draggable="true"]').count(),
    ).toBe(0);
    expect(
      await page
        .locator('[data-testid="slot-occupied"][draggable="false"]')
        .count(),
    ).toBeGreaterThanOrEqual(1);

    // …and the editing actions are gone: opening the slot context menu offers
    // no delete/move actions, only the non-mutating "Szczegóły ładunku".
    await occupied.first().click({ button: "right" });
    await expect(page.getByRole("menu")).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Szczegóły ładunku" }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Usuń ładunek" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("menuitem", { name: "Odłóż na listę ofert" }),
    ).toHaveCount(0);
  });
});
