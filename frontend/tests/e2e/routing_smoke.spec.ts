import { test, expect } from "@playwright/test";

import { createSessionWithOffers } from "./helpers";

/**
 * Routing smoke tests — App Router structure.
 *
 * Covers every new path introduced by the App Router migration:
 *   /            → hard redirect to /dashboard
 *   /dashboard   → Dashboard view (inside the AppShell layout group)
 *   /planner     → Planning lab
 *   /fleet       → Fleet manager
 *   /analytics   → Analytics
 *   /sessions/:id      → session detail (deep link)
 *   /sessions/:id/map  → route map (deep link)
 *
 * The four primary nav links must perform client-side (SPA) transitions —
 * i.e. without a full document reload — and the active link must expose
 * `aria-current="page"` together with its visible label.
 */

const MAIN_VIEWS = [
  { testid: "nav-planner", path: /\/planner$/, label: "Planning lab" },
  { testid: "nav-fleet", path: /\/fleet/, label: "Fleet manager" },
  { testid: "nav-analytics", path: /\/analytics/, label: "Analytics" },
  { testid: "nav-dashboard", path: /\/dashboard$/, label: "Dashboard" },
] as const;

test.describe("App Router navigation", () => {
  test("/ hard-redirects to /dashboard", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByTestId("nav-dashboard")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("main nav switches views client-side without a full reload", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await expect(page.getByTestId("nav-dashboard")).toBeVisible();

    // Sentinel survives client-side navigation but is wiped by a full reload.
    await page.evaluate(() => {
      (window as unknown as { __spaSentinel?: boolean }).__spaSentinel = true;
    });

    for (const view of MAIN_VIEWS) {
      const link = page.getByTestId(view.testid);
      await link.click();

      // SPA transition: URL changed…
      await expect(page).toHaveURL(view.path);
      // …active link is flagged for assistive tech…
      await expect(link).toHaveAttribute("aria-current", "page");
      // …its label is revealed (inactive labels collapse to zero width)…
      await expect(page.getByText(view.label, { exact: true })).toBeVisible();
      // …and no full page reload happened.
      const survived = await page.evaluate(
        () =>
          (window as unknown as { __spaSentinel?: boolean }).__spaSentinel ===
          true,
      );
      expect(survived, "expected a client-side transition (no full reload)").toBe(
        true,
      );
    }
  });

  test("deep-links straight to a session detail page and its map", async ({
    page,
    request,
  }) => {
    const { sessionId } = await createSessionWithOffers(request, 5);

    // Direct entry under /sessions/{uuid} renders the detail view.
    await page.goto(`/sessions/${sessionId}`);
    await expect(page.getByRole("heading", { name: /^Sesja/ })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page).toHaveURL(new RegExp(`/sessions/${sessionId}$`));

    // The nested map route is reachable as a deep link too.
    await page.goto(`/sessions/${sessionId}/map`);
    await expect(page).toHaveURL(new RegExp(`/sessions/${sessionId}/map$`));
    await expect(
      page.getByRole("heading", { name: "Mapa trasy" }),
    ).toBeVisible({ timeout: 30_000 });
  });
});
