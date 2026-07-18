/**
 * PolicyLens brand assets — a reusable logo mark + wordmark, and the "Lens"
 * AI assistant sparkle icon. All artwork is inline SVG using theme tokens so it
 * adapts to light/dark and the violet brand accent, with zero external files.
 */

type MarkProps = { className?: string };

/**
 * PolicyLens logo mark: a teal rounded-square badge holding a white magnifying
 * lens over a document — the product's core idea (we read the fine print).
 *
 * The mark uses a fixed teal→emerald gradient (not theme tokens) so the brand
 * looks identical on the customer dark theme, the broker navy sidebar, and the
 * favicon. Size it with `className` (e.g. "h-8 w-8").
 */
export function LensMark({ className = '' }: MarkProps) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={className} role="img" aria-label="PolicyLens">
      <defs>
        <linearGradient id="pl-badge" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#818CF8" />
          <stop offset="1" stopColor="#4F46E5" />
        </linearGradient>
      </defs>
      {/* Teal badge */}
      <rect width="40" height="40" rx="10" fill="url(#pl-badge)" />
      {/* Document peeking behind the lens */}
      <rect x="10" y="8.5" width="14" height="19" rx="2.5" fill="#FFFFFF" opacity="0.28" />
      <path d="M13.5 14h7M13.5 18h7M13.5 22h4" stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" opacity="0.85" />
      {/* Magnifying lens */}
      <circle cx="24" cy="23" r="7.5" fill="#0B1220" fillOpacity="0.18" />
      <circle cx="24" cy="23" r="7.5" stroke="#FFFFFF" strokeWidth="2.6" fill="none" />
      <circle cx="24" cy="23" r="2.6" fill="#FFFFFF" />
      <path d="M29.6 28.6l4 4" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

interface LogoProps {
  /** Show the "PolicyLens" wordmark next to the mark. Default true. */
  showWord?: boolean;
  /** Tailwind height class for the mark, e.g. "h-8 w-8". */
  markClassName?: string;
  /**
   * Wordmark color treatment:
   *  - `auto` (default): theme foreground + teal accent (light backgrounds).
   *  - `light`: white text for dark/navy backgrounds (e.g. broker sidebar).
   */
  tone?: 'auto' | 'light';
  className?: string;
}

/** Full brand lockup: {@link LensMark} + "PolicyLens" wordmark. */
export function Logo({
  showWord = true,
  markClassName = 'h-8 w-8',
  tone = 'auto',
  className = '',
}: LogoProps) {
  const wordClass =
    tone === 'light' ? 'text-white' : 'text-foreground';
  const accentClass = tone === 'light' ? 'text-[#818CF8]' : 'text-primary';
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LensMark className={markClassName} />
      {showWord && (
        <span className={`font-display text-xl font-extrabold tracking-tight ${wordClass}`}>
          Policy<span className={accentClass}>Lens</span>
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
