// tests/integration/cli/vitest.config.ts

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 660_000,
    // beforeAll bootstraps a test org over the network; the 10s default is
    // shorter than bootstrapTestOrg's own retry schedule, so retries never land.
    hookTimeout: 120_000,
    include: ["**/*.test.ts"],
  },
});
