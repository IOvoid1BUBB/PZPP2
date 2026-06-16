import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E config (FEAT-11).
 *
 * The app runs via Docker (`docker compose up -d --build`) and the Next.js
 * server proxies `/api/*` to the backend. Tests therefore assume the stack is
 * reachable at `PLAYWRIGHT_BASE_URL` (default http://localhost:3000).
 *
 * The `webServer` block brings the stack up automatically when nothing is yet
 * listening on the base URL. Note: this repo's `npm run dev` intentionally
 * fails (the frontend only runs inside Docker), so the web server command is
 * `docker compose up -d --build`, not `next dev`. `USE_SOLVER_MOCK=true` is
 * forwarded to the backend so the solver returns instantly and deterministically.
 *
 * Set `PW_REUSE=1` (e.g. in CI after starting the stack in a dedicated step) to
 * reuse an already-running stack and skip the web server command entirely.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // retries=0 — a flaky test is treated as a failure so it surfaces immediately.
  retries: 0,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI
    ? [["github"], ["list"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "docker compose up -d --build",
    cwd: "..",
    url: baseURL,
    // Reuse a stack that is already up (local dev, or CI when PW_REUSE=1).
    reuseExistingServer: process.env.PW_REUSE === "1" || !process.env.CI,
    // First-time image builds + migrations + seed can take a while; the per-test
    // budget (timeout above) is separate from this one-off bring-up.
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      USE_SOLVER_MOCK: process.env.USE_SOLVER_MOCK ?? "true",
      USE_ROUTING_MOCK: process.env.USE_ROUTING_MOCK ?? "true",
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
