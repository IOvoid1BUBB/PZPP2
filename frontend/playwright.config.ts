import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E config (FEAT-11).
 *
 * The app runs via Docker (`docker compose up -d --build`) and the Next.js
 * server proxies `/api/*` to the backend. Tests therefore assume the stack is
 * reachable at `PLAYWRIGHT_BASE_URL` (default http://localhost:3000).
 *
 * In CI set `USE_SOLVER_MOCK=true` on the backend so the solver returns fast.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
