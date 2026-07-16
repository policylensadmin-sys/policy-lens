// Makes the @testing-library/jest-dom matchers (e.g. toBeDisabled,
// toBeInTheDocument) visible to the TypeScript compiler for Vitest assertions.
// The runtime registration happens in tests/setup.ts; this file only supplies
// the type augmentation to the tsc program (which includes `src`).
import '@testing-library/jest-dom/vitest';
