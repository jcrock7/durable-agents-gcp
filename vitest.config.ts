import { defineConfig } from "vitest/config";

// Tests import the compiled packages (dist/), so `pnpm test` builds first.
// Temporal's test environment runs a local test server, so tests run in separate
// processes with generous timeouts.
export default defineConfig({
  test: {
    include: ["{packages,apps}/*/test/**/*.test.ts", "agents/*/*/test/**/*.test.ts"],
    pool: "forks",
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
