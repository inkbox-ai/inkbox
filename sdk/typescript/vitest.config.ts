import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      // Exclude the data-plane subpath: the runtime is not yet
      // implemented in TypeScript (see src/tunnels/client/index.ts),
      // and the bootstrap code preserved as `_unimplementedBootstrap`
      // is intentionally unreachable. Counting it would drag overall
      // coverage below threshold for code that is, by design, dead
      // until the runtime ships.
      exclude: [
        "src/tunnels/client/**",
        // vitest defaults that we still want to honor
        "**/node_modules/**",
        "**/dist/**",
        "**/tests/**",
        "**/*.config.*",
        "**/coverage/**",
      ],
    },
  },
});
