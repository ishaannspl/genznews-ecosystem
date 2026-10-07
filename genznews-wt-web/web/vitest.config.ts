import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
      // Next aliases `server-only` to its compiled copy at build time; unit tests import the
      // marked modules directly, so they get the empty (no-op) variant.
      {
        find: /^server-only$/,
        replacement: fileURLToPath(new URL("./node_modules/next/dist/compiled/server-only/empty.js", import.meta.url)),
      },
    ],
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // Generous limits: the suite timed out under machine load with the 5 s default.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
