import { defineConfig } from 'vitest/config';

// Backend test configuration: runs in a Node environment for API/service/unit
// and property-based tests (Vitest + fast-check + Supertest).
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    // fast-check property tests can run many iterations; allow generous timeout.
    testTimeout: 20_000,
  },
});
