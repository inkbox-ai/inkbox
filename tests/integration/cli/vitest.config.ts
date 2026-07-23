// tests/integration/cli/vitest.config.ts

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 660_000,
    include: ["**/*.test.ts"],
  },
});
