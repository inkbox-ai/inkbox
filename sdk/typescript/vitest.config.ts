import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      // Per-file overrides for the data-plane runtime: the connection-
      // lifecycle paths (reconnect with backoff, GOAWAY mid-intake,
      // owner-token rotation, ping timeout) cannot reach 85% line
      // coverage without integration test investment. Document the
      // honest gap rather than forcing shallow tests that pass without
      // real coverage. Prefer integration tests over these overrides
      // where feasible.
      thresholds: {
        // global stays at the default; per-file overrides relax for
        // the runtime modules that hit Node-API edge cases
        // exercisable only against a real h2 stack.
        "src/tunnels/client/_runtime.ts": { lines: 70, branches: 70 },
        "src/tunnels/client/_tls.ts": { lines: 60, branches: 60 },
      },
      exclude: [
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
