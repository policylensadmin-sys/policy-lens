import { defineConfig } from 'vitest/config';

// Frontend test configuration: runs in a jsdom environment so later
// component tests (@testing-library/react + jest-dom matchers) can render.
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
  },
});
