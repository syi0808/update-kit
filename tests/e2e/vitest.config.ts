import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: "tests/e2e",
    include: ["**/*.e2e.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 15_000,
    pool: "forks",
    globals: true,
  },
});
