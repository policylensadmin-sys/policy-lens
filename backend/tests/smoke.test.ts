import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

// Smoke test: verifies the backend test runner (Vitest) is wired up and that
// fast-check is available for the property-based tests added in later tasks.
describe('backend test tooling smoke test', () => {
  it('runs a basic assertion', () => {
    expect(true).toBe(true);
  });

  it('has fast-check available for property tests', () => {
    fc.assert(
      fc.property(fc.integer(), (n) => {
        // Addition identity holds for any integer.
        return n + 0 === n;
      }),
    );
  });
});
