import type { CitedSection } from '@policylens/shared';

/**
 * CitedClauseChip — a single cited-clause chip shown beneath a grounded chat
 * answer (R5.2).
 *
 * Renders the source section label together with the match strength as a
 * percentage (the shared {@link CitedSection.match} is a 0–1 similarity, so it
 * is scaled to 0–100 for display). Chips let the reader trace an answer back to
 * the specific clause of their policy that supports it.
 */

interface CitedClauseChipProps {
  citation: CitedSection;
}

/** Clamp a 0–1 match into a whole-number percentage for display. */
export function toMatchPercent(match: number): number {
  if (!Number.isFinite(match)) {
    return 0;
  }
  const clamped = Math.min(1, Math.max(0, match));
  return Math.round(clamped * 100);
}

export function CitedClauseChip({ citation }: CitedClauseChipProps) {
  const percent = toMatchPercent(citation.match);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs text-accent"
      title={`Section ${citation.section} — ${percent}% match`}
    >
      <span aria-hidden className="text-[0.65rem]">§</span>
      <span className="font-medium">{citation.section}</span>
      <span className="text-accent/70">{percent}% match</span>
    </span>
  );
}

export default CitedClauseChip;
