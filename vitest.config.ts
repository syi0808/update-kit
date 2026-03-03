import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    passWithNoTests: true,
    exclude: ["tests/dist/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/__tests__/**",
        "src/**/*.test.ts",
        "src/cli.ts",
        "src/types.ts",
        "src/config.ts",
        "src/applier/types.ts",
        "src/applier/index.ts",
      ],
    },
  },
});
