/**
 * PolicyLens brand assets — a reusable logo mark + wordmark, and the "Lens"
 * AI assistant sparkle icon. All artwork is inline SVG using theme tokens so it
 * adapts to light/dark and the violet brand accent, with zero external files.
 */

type MarkProps = { className?: string };

/**
 * PolicyLens logo mark: a magnifying lens reading a document — the product's
 * core idea (we read the fine print). Uses the brand `primary` color.
 */
export function LensMark({ className = '' }: MarkProps) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden>
      <defs>
        <linearGradient id="pl-grad" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="currentColor" className="text-primary" />
          <stop offset="1" stopColor="currentColor" className="text-primary/60" />
        </linearGradient>
      </defs>
      {/* rounded document */}
      <rect x="6" y="4" width="21" height="28" rx="4" className="fill-primary/15 stroke-primary" strokeWidth="2" />
      <path d="M11 12h10M11 17h10M11 22h6" className="stroke-primary" strokeWidth="2" strokeLinecap="round" />
      {/* magnifying lens */}
      <circle cx="26" cy="25" r="8.5" fill="url(#pl-grad)" className="opacity-90" />
      <circle cx="26" cy="25" r="8.5" className="stroke-primary" strokeWidth="2" fill="none" />
      <circle cx="26" cy="25" r="3.4" className="fill-surface" />
      <path d="M32.5 31.5l4 4" className="stroke-primary" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

interface LogoProps {
  /** Show the "PolicyLens" wordmark next to the mark. Default true. */
  showWord?: boolean;
  /** Tailwind height class for the mark, e.g. "h-8 w-8". */
  markClassName?: string;
  className?: string;
}

/** Full brand lockup: {@link LensMark} + "PolicyLens" wordmark. */
export function Logo({
  showWord = true,
  markClassName = 'h-8 w-8',
  className = '',
}: LogoProps) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LensMark className={`${markClassName} text-primary`} />
      {showWord && (
        <span className="font-display text-xl font-extrabold tracking-tight text-foreground">
          Policy<span className="text-primary">Lens</span>
        </span>
      )}
    </span>
  );
}

/**
 * "Lens" — the AI assistant sparkle. A four-point star (Gemini-style) but in the
 * PolicyLens palette (violet→teal gradient) to keep the identity distinct.
 */
export function LensSparkle({ className = '' }: MarkProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <defs>
        <linearGradient id="lens-spark" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8B5CF6" />
          <stop offset="0.55" stopColor="#6366F1" />
          <stop offset="1" stopColor="#22D3EE" />
        </linearGradient>
      </defs>
      {/* main 4-point star */}
      <path
        d="M12 1.6c.5 4.8 2.9 7.2 7.7 7.7v.4c-4.8.5-7.2 2.9-7.7 7.7h-.4c-.5-4.8-2.9-7.2-7.7-7.7v-.4c4.8-.5 7.2-2.9 7.7-7.7h.4z"
        fill="url(#lens-spark)"
      />
      {/* small accent star */}
      <path
        d="M18.5 15.2c.2 1.7 1 2.5 2.7 2.7v.2c-1.7.2-2.5 1-2.7 2.7h-.2c-.2-1.7-1-2.5-2.7-2.7v-.2c1.7-.2 2.5-1 2.7-2.7h.2z"
        fill="url(#lens-spark)"
        opacity="0.85"
      />
    </svg>
  );
}

/** Badge-style "Ask Lens" AI button label (sparkle + text). */
export function AskLensLabel({ className = '' }: MarkProps) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LensSparkle className="h-4 w-4" />
      <span>
        Ask <span className="font-semibold">Lens</span>
      </span>
    </span>
  );
}

export default Logo;
