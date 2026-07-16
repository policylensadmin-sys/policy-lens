import { describe, expect, it } from 'vitest';

// Smoke test: verifies the frontend test runner (Vitest) is wired up and that
// the jsdom environment provides a DOM for later component tests.
describe('frontend test tooling smoke test', () => {
  it('runs a basic assertion', () => {
    expect(true).toBe(true);
  });

  it('has a jsdom document available', () => {
    expect(typeof document).toBe('object');
    const el = document.createElement('div');
    el.textContent = 'PolicyLens';
    expect(el.textContent).toBe('PolicyLens');
  });
});
