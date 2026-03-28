import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    passWithNoTests: true,
    exclude: [
      "tests/dist/**",
      "node_modules/**",
      // E2E tests rely on POSIX shell mocks and Unix CLI tools (zip, tar) —
      // skip on Windows where these are unavailable.
      ...(process.platform === "win32" ? ["tests/e2e/**"] : []),
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "json"],
      reportOnFailure: true,
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
