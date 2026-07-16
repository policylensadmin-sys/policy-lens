// ChunkingService — sentence-aware policy text splitter (R15.1).
//
// Splits raw policy text (optionally per-page/section) into overlapping
// Policy_Chunks sized for embedding. Each chunk targets <= MAX_TOKENS with
// ~OVERLAP_RATIO overlap carried between consecutive chunks so that retrieved
// context never loses information straddling a chunk boundary.
//
// Token counts are *estimated* — exact model tokenization is unnecessary for
// sizing, so we approximate tokens from character length (see estimateTokens).
//
// Design invariants (property-tested in task 5.3):
//   1. every chunk's estimated token count <= MAX_TOKENS;
//   2. no chunk is empty (whitespace-only input yields zero chunks);
//   3. concatenating the non-overlap ("new") content of each chunk, in order,
//      reconstructs the source sentence sequence;
//   4. the overlap between two consecutive chunks stays within OVERLAP_BUDGET
//      tokens (and is always strictly smaller than the earlier chunk, so the
//      splitter always makes forward progress).

import type { ChunkContext } from '@policylens/shared';

// ---------------------------------------------------------------------------
// Tuning constants.
// ---------------------------------------------------------------------------

/** Maximum estimated tokens per chunk (R15.1: "no more than 512 tokens"). */
export const MAX_TOKENS = 512;

/** Fraction of a chunk (in tokens) carried forward as overlap. */
export const OVERLAP_RATIO = 0.15;

/**
 * Average characters per token used by {@link estimateTokens}. ~4 chars/token
 * is a common heuristic for English text and errs slightly high, keeping us
 * safely under real tokenizer limits.
 */
export const CHARS_PER_TOKEN = 4;

/** Token budget available for inter-chunk overlap. */
export const OVERLAP_BUDGET = Math.floor(MAX_TOKENS * OVERLAP_RATIO);

// ---------------------------------------------------------------------------
// Public types.
// ---------------------------------------------------------------------------

/**
 * A produced chunk. Structurally the RAG {@link ChunkContext} minus the
 * retrieval-time `similarity` score (added later during search).
 */
export type Chunk = Omit<ChunkContext, 'similarity'>;

/** A contiguous source region with optional page/section metadata. */
export interface ChunkSource {
  text: string;
  /** 1-based page number, when known. */
  page?: number | null;
  /** Section/heading label, when known. */
  section?: string | null;
}

/**
 * Input to {@link chunkText}: either a plain string, or an ordered list of
 * page/section segments whose metadata is preserved on the emitted chunks.
 */
export type ChunkInput = string | ChunkSource[];

// ---------------------------------------------------------------------------
// Token estimation.
// ---------------------------------------------------------------------------

/** Estimate the token count of a string (see {@link CHARS_PER_TOKEN}). */
export function estimateTokens(text: string): number {
  const len = text.trim().length;
  return len === 0 ? 0 : Math.ceil(len / CHARS_PER_TOKEN);
}

// ---------------------------------------------------------------------------
// Sentence handling.
// ---------------------------------------------------------------------------

/** A single indivisible unit of text (a sentence or a hard-split fragment). */
interface Unit {
  text: string;
  tokens: number;
}

/**
 * Split text into trimmed, non-empty sentences. Whitespace is normalized to
 * single spaces so that overlap regions are character-identical across
 * consecutive chunks (required for reconstruction).
 */
function splitSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) return [];
  const matches = normalized.match(/[^.!?]*[.!?]+|[^.!?]+$/g);
  if (!matches) return [normalized];
  return matches.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Break a sentence that alone exceeds {@link MAX_TOKENS} into word-based
 * fragments each within budget. Guarantees invariant #1 even for pathological
 * inputs (e.g. a single very long "sentence" with no terminators).
 */
function hardSplit(sentence: string, maxTokens: number): string[] {
  if (estimateTokens(sentence) <= maxTokens) return [sentence];

  const fragments: string[] = [];
  const words = sentence.split(' ');
  let current = '';

  const push = () => {
    const trimmed = current.trim();
    if (trimmed.length > 0) fragments.push(trimmed);
    current = '';
  };

  for (const word of words) {
    // A single word longer than the budget: split it by characters.
    if (estimateTokens(word) > maxTokens) {
      push();
      const maxChars = maxTokens * CHARS_PER_TOKEN;
      for (let i = 0; i < word.length; i += maxChars) {
        fragments.push(word.slice(i, i + maxChars));
      }
      continue;
    }

    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (estimateTokens(candidate) > maxTokens) {
      push();
      current = word;
    } else {
      current = candidate;
    }
  }
  push();
  return fragments;
}

/** Turn a source segment's text into indivisible, budget-sized units. */
function toUnits(text: string): Unit[] {
  const units: Unit[] = [];
  for (const sentence of splitSentences(text)) {
    for (const fragment of hardSplit(sentence, MAX_TOKENS)) {
      units.push({ text: fragment, tokens: estimateTokens(fragment) });
    }
  }
  return units;
}

// ---------------------------------------------------------------------------
// Chunking.
// ---------------------------------------------------------------------------

/** Normalize {@link ChunkInput} into an ordered list of segments. */
function toSegments(input: ChunkInput): ChunkSource[] {
  return typeof input === 'string' ? [{ text: input }] : input;
}

/**
 * Greedily pack a single segment's units into overlapping chunks and append
 * them to `out`, returning the next chunk index.
 */
function chunkSegment(
  segment: ChunkSource,
  startIndex: number,
  out: Chunk[]
): number {
  const units = toUnits(segment.text);
  if (units.length === 0) return startIndex;

  let index = startIndex;
  let i = 0;

  while (i < units.length) {
    const start = i;
    let tokens = 0;
    let end = i;

    // Pack forward while we stay within budget; always take at least one unit.
    while (end < units.length) {
      const next = units[end]!;
      if (end > start && tokens + next.tokens > MAX_TOKENS) break;
      tokens += next.tokens;
      end += 1;
    }

    const content = units
      .slice(start, end)
      .map((u) => u.text)
      .join(' ');

    out.push({
      chunkIndex: index,
      content,
      section: segment.section ?? null,
      page: segment.page ?? null,
    });
    index += 1;

    // Done with this segment once the last unit is consumed.
    if (end >= units.length) break;

    // Carry trailing units forward as overlap, staying within OVERLAP_BUDGET
    // and always leaving at least one new unit (so we make forward progress).
    let overlapCount = 0;
    let overlapTokens = 0;
    for (let j = end - 1; j > start; j -= 1) {
      const unit = units[j]!;
      if (overlapTokens + unit.tokens > OVERLAP_BUDGET) break;
      overlapTokens += unit.tokens;
      overlapCount += 1;
    }

    i = end - overlapCount;
  }

  return index;
}

/**
 * Split policy text into overlapping, metadata-preserving chunks.
 *
 * @param input Raw text, or ordered page/section segments.
 * @returns Chunks in source order with a contiguous, 0-based `chunkIndex`.
 */
export function chunkText(input: ChunkInput): Chunk[] {
  const chunks: Chunk[] = [];
  let index = 0;
  for (const segment of toSegments(input)) {
    index = chunkSegment(segment, index, chunks);
  }
  return chunks;
}

/**
 * Stateless service wrapper around {@link chunkText}, matching the service
 * layout used elsewhere in the backend.
 */
export class ChunkingService {
  /** @see chunkText */
  chunk(input: ChunkInput): Chunk[] {
    return chunkText(input);
  }
}
