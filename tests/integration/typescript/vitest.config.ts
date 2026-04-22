// tests/integration/typescript/vitest.config.ts

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 300_000,
    include: ["**/*.test.ts"],
    // One bootstrap per `vitest run`, shared across every test file in this dir
    globalSetup: ["./globalSetup.ts"],
    // Force serial file execution so tests that share the bootstrap org run
    // in a deterministic order (alphabetical: lifecycle before signup).
    fileParallelism: false,
    sequence: { shuffle: false },
  },
});
