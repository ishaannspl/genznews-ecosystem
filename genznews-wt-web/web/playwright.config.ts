import { defineConfig, devices } from "@playwright/test";

/**
 * Two isolated servers, each with its own build directory so the owner's `.next` and dev
 * server (port 3100) are never touched. Neither may attach to an existing server.
 *
 * 3110: production build, DATA_SOURCE=fixtures. This is DEMO data, used only so the UI is
 *       tested against stable content. It must never be a production setting.
 * 3111: real-data failure mode. The Supabase host (a closed local port) refuses connections
 *       at once, and the suite proves the site then shows an error and never any demo article.
 *       It runs `next dev`, not a production build: the home page rethrows repository errors
 *       (so ISR never caches an error home), which makes `next build` fail at "/" while the
 *       database is unreachable. Dev compiles each route on its first request, so the spec
 *       warms its routes first and uses longer timeouts.
 */
const FIXTURES_PORT = 3110;
const REAL_PORT = 3111;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: { trace: "retain-on-failure" },
  projects: [
    {
      name: "fixtures",
      testIgnore: /real-data-failure\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${FIXTURES_PORT}` },
    },
    {
      name: "real-data-failure",
      testMatch: /real-data-failure\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${REAL_PORT}` },
    },
  ],
  webServer: [
    {
      command: `npm run build && npm run start -- -p ${FIXTURES_PORT}`,
      url: `http://localhost:${FIXTURES_PORT}/robots.txt`,
      reuseExistingServer: false,
      timeout: 300_000,
      env: {
        DATA_SOURCE: "fixtures",
        NEXT_PUBLIC_SITE_URL: `http://localhost:${FIXTURES_PORT}`,
        REVALIDATE_SECRET: "e2e-secret",
        DATA_LOG: "0",
        NEXT_DIST_DIR: ".next-e2e",
      },
    },
    {
      // Server output goes to a log file the failure spec reads.
      command: `mkdir -p .e2e-logs && npm run dev -- -p ${REAL_PORT} > .e2e-logs/real-server.log 2>&1`,
      url: `http://localhost:${REAL_PORT}/robots.txt`,
      reuseExistingServer: false,
      timeout: 300_000,
      env: {
        DATA_SOURCE: "supabase",
        // Not port 9: fetch refuses "bad ports" (9 among them) before connecting, so the log would say "bad port".
        SUPABASE_URL: "http://127.0.0.1:59871",
        SUPABASE_ANON_KEY: "sb_publishable_FAKEKEY123",
        NEXT_PUBLIC_SITE_URL: `http://localhost:${REAL_PORT}`,
        DATA_LOG: "1",
        NEXT_DIST_DIR: ".next-e2e-real",
      },
    },
  ],
});
