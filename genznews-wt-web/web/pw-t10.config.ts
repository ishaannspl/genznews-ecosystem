import { defineConfig, devices } from "@playwright/test";
const port = process.env.T10_PORT;
export default defineConfig({
  testDir: "./e2e",
  testMatch: /console-clean\.spec\.ts/,
  timeout: 90_000,
  reporter: [["list"]],
  use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${port}` },
});
