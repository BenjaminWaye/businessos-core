import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration tests share a single Postgres database, so run files
    // serially to keep the event log isolated and deterministic.
    fileParallelism: false,
    globalSetup: ["./src/__tests__/global-setup.ts"],
    include: ["src/**/*.test.ts"],
  },
});
