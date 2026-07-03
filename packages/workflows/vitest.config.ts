import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    globalSetup: ["./src/__tests__/global-setup.ts"],
    include: ["src/**/*.test.ts"],
  },
});
