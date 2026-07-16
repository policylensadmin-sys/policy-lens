// Small deterministic hashing / PRNG helpers used by the mock adapters.
//
// These give the mock providers stable, reproducible output across runs (and
// across processes) — important so pgvector similarity ordering is consistent
// during Demo/Mock mode and so tests are not flaky.

/** 32-bit FNV-1a hash of a string, returned as an unsigned integer. */
export function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // 32-bit FNV prime multiply via Math.imul to stay in 32-bit range.
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Mulberry32 PRNG. Given a 32-bit seed, returns a function producing a
 * deterministic sequence of floats in [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
