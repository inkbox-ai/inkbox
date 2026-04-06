// tests/integration/typescript/vitest.config.ts

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 300_000,
    include: ["**/*.test.ts"],
  },
});
