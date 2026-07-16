// Property-based tests for the sentence-aware policy chunker (R15.1).
//
// Task 5.3 — validates the four design invariants documented in
// `src/services/policy/chunking.ts`:
//   1. SIZE           — every produced chunk has estimateTokens(content)
//                       <= MAX_TOKENS, for ANY input text;
//   2. NON-EMPTY      — no chunk is whitespace-only, and whitespace-only
//                       input yields zero chunks;
//   3. ORDER          — chunkIndex is a contiguous ascending run 0,1,2,...;
//   4. OVERLAP        — the token overlap carried between two consecutive
//                       chunks stays within OVERLAP_BUDGET (and is strictly
//                       smaller than the earlier chunk — forward progress).
//
// Validates: Requirements 15.1

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  chunkText,
  estimateTokens,
  MAX_TOKENS,
  OVERLAP_BUDGET,
  CHARS_PER_TOKEN,
} from '../src/services/policy/chunking';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Re-split a chunk's content into sentence "units" using the exact same rule
 * the chunker uses internally (see splitSentences). Because chunk content is
 * already whitespace-normalized, this reconstructs the original unit list and
 * lets us reason about inter-chunk overlap at unit granularity.
 */
function splitUnits(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) return [];
  const matches = normalized.match(/[^.!?]*[.!?]+|[^.!?]+$/g);
  return matches ? matches.map((s) => s.trim()).filter((s) => s.length > 0) : [normalized];
}

/** The number of leading units of `b` that equal the trailing units of `a`. */
function overlapUnitCount(a: string[], b: string[]): number {
  const max = Math.min(a.length, b.length);
  for (let k = max; k > 0; k -= 1) {
    let match = true;
    for (let j = 0; j < k; j += 1) {
      if (a[a.length - k + j] !== b[j]) {
        match = false;
        break;
      }
    }
    if (match) return k;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');
const charArb = fc.constantFrom(...ALPHABET);

/** A non-empty word with no whitespace or sentence terminators. */
const wordArb = fc.array(charArb, { minLength: 1, maxLength: 12 }).map((c) => c.join(''));

/** A sentence: a few words followed by a terminator. */
const sentenceArb = fc
  .tuple(fc.array(wordArb, { minLength: 1, maxLength: 12 }), fc.constantFrom('.', '!', '?'))
  .map(([words, end]) => words.join(' ') + end);

/** A single word longer than MAX_TOKENS — forces hardSplit's char splitting. */
const longWordArb = fc
  .integer({ min: MAX_TOKENS * CHARS_PER_TOKEN + 1, max: MAX_TOKENS * CHARS_PER_TOKEN * 3 })
  .map((n) => 'a'.repeat(n));

/** A single very long spaced "sentence" — forces hardSplit's word splitting. */
const longSentenceArb = fc
  .array(wordArb, { minLength: 400, maxLength: 800 })
  .map((words) => words.join(' ') + '.');

/**
 * A broad text generator spanning the realistic input space: raw fuzz,
 * paragraphs of sentences (with and without spaces after terminators, to
 * exercise re-joining), pathological long words/sentences (hardSplit), and
 * mixtures of the above.
 */
const textArb = fc.oneof(
  fc.string(),
  fc.array(sentenceArb, { minLength: 1, maxLength: 40 }).map((s) => s.join(' ')),
  fc.array(sentenceArb, { minLength: 1, maxLength: 40 }).map((s) => s.join('')),
  longWordArb,
  longSentenceArb,
  fc.array(fc.oneof(sentenceArb, longWordArb), { minLength: 1, maxLength: 10 }).map((a) => a.join(' ')),
);

/** Whitespace-only strings. */
const whitespaceArb = fc
  .array(fc.constantFrom(' ', '\t', '\n', '\r', '\f', '\v'), { minLength: 0, maxLength: 40 })
  .map((c) => c.join(''));

/**
 * Text built from uniquely-prefixed sentences ("s0 ...", "s1 ...", ...) so
 * that inter-chunk overlap is unambiguous: each unit's leading token appears
 * exactly once, anchoring overlap detection to true unit boundaries. Uses many
 * modest sentences to reliably produce multiple, overlapping chunks.
 */
const uniqueTextArb = fc
  .array(fc.array(wordArb, { minLength: 1, maxLength: 10 }).map((w) => w.join(' ')), {
    minLength: 30,
    maxLength: 80,
  })
  .map((bodies) => bodies.map((b, i) => `s${i} ${b}`).join('. ') + '.');

// ---------------------------------------------------------------------------
// Property 1: SIZE
// ---------------------------------------------------------------------------

describe('chunkText — Property SIZE', () => {
  it('every chunk has estimateTokens(content) <= MAX_TOKENS for ANY text', () => {
    fc.assert(
      fc.property(textArb, (text) => {
        for (const chunk of chunkText(text)) {
          expect(estimateTokens(chunk.content)).toBeLessThanOrEqual(MAX_TOKENS);
        }
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: NON-EMPTY
// ---------------------------------------------------------------------------

describe('chunkText — Property NON-EMPTY', () => {
  it('no produced chunk is empty or whitespace-only', () => {
    fc.assert(
      fc.property(textArb, (text) => {
        for (const chunk of chunkText(text)) {
          expect(chunk.content.trim().length).toBeGreaterThan(0);
        }
      }),
    );
  });

  it('whitespace-only input yields zero chunks', () => {
    fc.assert(
      fc.property(whitespaceArb, (text) => {
        expect(chunkText(text)).toEqual([]);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: ORDER
// ---------------------------------------------------------------------------

describe('chunkText — Property ORDER', () => {
  it('chunkIndex is a contiguous ascending sequence 0,1,2,...', () => {
    fc.assert(
      fc.property(textArb, (text) => {
        const chunks = chunkText(text);
        const indices = chunks.map((c) => c.chunkIndex);
        expect(indices).toEqual(chunks.map((_, i) => i));
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: OVERLAP
// ---------------------------------------------------------------------------

describe('chunkText — Property OVERLAP', () => {
  it('overlap between consecutive chunks stays within OVERLAP_BUDGET tokens', () => {
    fc.assert(
      fc.property(uniqueTextArb, (text) => {
        const chunks = chunkText(text);
        for (let i = 1; i < chunks.length; i += 1) {
          const prev = splitUnits(chunks[i - 1]!.content);
          const curr = splitUnits(chunks[i]!.content);
          const k = overlapUnitCount(prev, curr);

          // Forward progress: overlap is strictly smaller than the earlier chunk.
          expect(k).toBeLessThan(prev.length);

          // Overlap token budget: sum of overlap unit token estimates <= budget.
          const overlapTokens = curr
            .slice(0, k)
            .reduce((sum, unit) => sum + estimateTokens(unit), 0);
          expect(overlapTokens).toBeLessThanOrEqual(OVERLAP_BUDGET);
        }
      }),
    );
  });
});
