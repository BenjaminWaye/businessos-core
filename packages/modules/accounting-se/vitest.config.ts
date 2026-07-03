import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The integration test shares a Postgres database with other suites, so
    // run files serially to keep the event log deterministic.
    fileParallelism: false,
    globalSetup: ["./src/__tests__/global-setup.ts"],
    include: ["src/**/*.test.ts"],
  },
});
