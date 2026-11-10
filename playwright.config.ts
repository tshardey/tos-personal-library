import { defineConfig, devices } from "@playwright/test";

/**
 * The scanner walkthrough (Task 9). Runs inside the `e2e` container against the LOCAL Supabase
 * stack only: global-setup aborts unless the URL's host is local.
 *
 *   E2E_SUPABASE_PUBLISHABLE_KEY=<local key> docker compose run --rm e2e npx playwright test
 */
const supabaseUrl = process.env.E2E_SUPABASE_URL ?? "http://host.docker.internal:54321";
const publishableKey = process.env.E2E_SUPABASE_PUBLISHABLE_KEY ?? "";
const PORT = 5174;

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://localhost:${PORT}/tos-personal-library/`,
    viewport: { width: 390, height: 844 },
    trace: "retain-on-failure",
    launchOptions: {
      // Precise performance.memory and a callable gc() for the long-session memory check.
      args: ["--enable-precise-memory-info", "--js-flags=--expose-gc"],
    },
  },
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/tos-personal-library/`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_SUPABASE_URL: supabaseUrl,
      VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey,
      VITE_GOOGLE_BOOKS_API_KEY: "",
    },
  },
});
