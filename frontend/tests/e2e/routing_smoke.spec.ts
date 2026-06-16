import { test, expect, type Page } from "@playwright/test";

import { createSessionWithOffers } from "./helpers";

/**
 * App Router routing smoke tests.
 *
 * Covers the migrated Next.js App Router structure:
 *   - the hard "/" → "/dashboard" redirect,
 *   - client-side (SPA) navigation between the four main views,
 *   - the active-link `aria-current="page"` contract on the AppShell nav,
 *   - deep linking into the dynamic session detail + map routes.
 *
 * These tests assert routing behaviour only (URLs, nav state, page headers),
 * so they stay fast and resilient regardless of backend data volume.
 */

/**
 * Stamp a sentinel on `window`. Any subsequent full page reload wipes it, so a
 * surviving sentinel proves the transition was a client-side navigation rather
 * than a browser document load.
 */
async function markSpaSentinel(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __spaSentinel?: boolean }).__spaSentinel = true;
  });
}

async function spaSentinelSurvived(page: Page): Promise<boolean> {
  return page.evaluate(
    () => (window as unknown as { __spaSentinel?: boolean }).__spaSentinel === true,
  );
}

test.describe("App Router — routing smoke", () => {
  test('"/" hard-redirects to /dashboard', async ({ page }) => {
    await page.goto("/");
    await page.waitForURL("**/dashboard");
    expect(new URL(page.url()).pathname).toBe("/dashboard");

    // The dashboard nav link is marked as the active page.
    await expect(page.getByTestId("nav-dashboard")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("the four main views navigate as client-side transitions", async ({
    page,
  }) => {
    const views = [
      { testId: "nav-dashboard", path: "/dashboard" },
      { testId: "nav-planner", path: "/planner" },
      { testId: "nav-fleet", path: "/fleet" },
      { testId: "nav-analytics", path: "/analytics" },
    ] as const;

    await page.goto("/dashboard");
    await page.waitForURL("**/dashboard");
    // Establish the sentinel after the first real document load.
    await markSpaSentinel(page);

    for (const { testId, path } of views) {
      const link = page.getByTestId(testId);
      await expect(link).toBeVisible();
      await link.click();

      await page.waitForURL(`**${path}`);
      expect(new URL(page.url()).pathname).toBe(path);

      // The clicked link is the only one marked as the current page.
      await expect(page.getByTestId(testId)).toHaveAttribute(
        "aria-current",
        "page",
      );

      // The AppShell persists across transitions (no full document reload).
      expect(await spaSentinelSurvived(page)).toBe(true);
    }
  });

  test("the Planning lab view renders its planner UI", async ({ page }) => {
    await page.goto("/planner");
    // A fresh session shows the VehicleSelector with the seeded vehicle cards.
    await expect(page.locator("#vehicle-card-man_solo")).toBeVisible({
      timeout: 30_000,
    });
  });

  test("deep links resolve the dynamic session detail + map routes", async ({
    page,
    request,
  }) => {
    const { sessionId } = await createSessionWithOffers(request, 5);

    // /sessions/{uuid} → session detail
    await page.goto(`/sessions/${sessionId}`);
    await expect(
      page.getByRole("heading", { name: new RegExp(`Sesja ${sessionId.slice(0, 8)}`) }),
    ).toBeVisible({ timeout: 30_000 });

    // /sessions/{uuid}/map → route map (header is statically rendered)
    await page.goto(`/sessions/${sessionId}/map`);
    await expect(page.getByRole("heading", { name: "Mapa trasy" })).toBeVisible();
    await expect(page.getByText(sessionId)).toBeVisible();
  });
});
