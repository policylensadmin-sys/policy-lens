// Vitest setup for the frontend workspace.
// Registers @testing-library/jest-dom matchers (e.g. toBeInTheDocument)
// so later component tests can use them. Also cleans up the DOM between tests.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
