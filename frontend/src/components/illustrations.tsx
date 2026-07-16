/**
 * Bespoke inline SVG illustrations and icons for the marketing pages.
 *
 * All artwork is hand-built with theme tokens (`currentColor` / the violet
 * `primary`) so it adapts to light/dark automatically and ships with zero
 * external image requests. Using inline SVG keeps the design distinctive and
 * fully under our control rather than relying on stock imagery.
 */

type IconProps = { className?: string };

/** Large hero artwork: a policy document being "read" — scan beam, extracted
 * clause chips and a live health-score dial. Decorative. */
export function HeroArt({ className = '' }: IconProps) {
  return (
    <svg
      viewBox="0 0 420 380"
      fill="none"
      role="img"
      aria-label="A policy document being analyzed into a health score"
      className={className}
    >
      {/* soft backdrop blobs */}
      <circle cx="320" cy="90" r="70" fill="currentColor" className="text-primary/20" />
      <circle cx="90" cy="300" r="55" fill="currentColor" className="text-primary/10" />

      {/* document */}
      <g>
        <rect x="60" y="40" width="220" height="290" rx="16" className="fill-surface stroke-border" strokeWidth="2" />
        <rect x="88" y="72" width="120" height="14" rx="7" className="fill-primary/70" />
        <rect x="88" y="104" width="164" height="8" rx="4" className="fill-muted/40" />
        <rect x="88" y="122" width="150" height="8" rx="4" className="fill-muted/40" />
        <rect x="88" y="140" width="164" height="8" rx="4" className="fill-muted/40" />
        <rect x="88" y="170" width="90" height="8" rx="4" className="fill-muted/40" />
        <rect x="88" y="196" width="164" height="8" rx="4" className="fill-muted/30" />
        <rect x="88" y="214" width="140" height="8" rx="4" className="fill-muted/30" />
        <rect x="88" y="240" width="164" height="8" rx="4" className="fill-muted/30" />
        <rect x="88" y="258" width="110" height="8" rx="4" className="fill-muted/30" />
      </g>

      {/* scan beam */}
      <rect x="60" y="150" width="220" height="26" rx="4" className="fill-primary/25" />
      <rect x="60" y="150" width="220" height="3" className="fill-primary" />

      {/* floating clause chip */}
      <g>
        <rect x="230" y="196" width="150" height="58" rx="12" className="fill-surface stroke-primary/40" strokeWidth="2" />
        <circle cx="252" cy="225" r="9" className="fill-primary/20" />
        <path d="M248 225l3 3 5-6" className="stroke-primary" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <rect x="270" y="214" width="94" height="7" rx="3.5" className="fill-foreground/70" />
        <rect x="270" y="230" width="70" height="6" rx="3" className="fill-muted/50" />
      </g>

      {/* health-score dial */}
      <g transform="translate(300 280)">
        <circle r="56" className="fill-surface stroke-border" strokeWidth="2" />
        <circle r="44" className="stroke-primary/20" strokeWidth="8" fill="none" />
        <circle
          r="44"
          className="stroke-primary"
          strokeWidth="8"
          fill="none"
          strokeLinecap="round"
          strokeDasharray="276"
          strokeDashoffset="66"
          transform="rotate(-90)"
        />
        <text textAnchor="middle" dy="4" className="fill-foreground" style={{ font: '700 26px Sora, sans-serif' }}>
          86
        </text>
        <text textAnchor="middle" dy="24" className="fill-muted" style={{ font: '500 9px Plus Jakarta Sans, sans-serif' }}>
          HEALTH SCORE
        </text>
      </g>
    </svg>
  );
}

export function HealthIcon({ className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden>
      <rect x="4" y="8" width="40" height="32" rx="8" className="fill-primary/12" />
      <path d="M14 24h5l3-7 4 14 3-7h5" className="stroke-primary" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

export function MotorIcon({ className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden>
      <rect x="4" y="8" width="40" height="32" rx="8" className="fill-primary/12" />
      <path d="M12 30v-4l3-7h18l3 7v4" className="stroke-primary" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <circle cx="16" cy="30" r="3" className="fill-primary" />
      <circle cx="32" cy="30" r="3" className="fill-primary" />
    </svg>
  );
}

export function LifeIcon({ className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden>
      <rect x="4" y="8" width="40" height="32" rx="8" className="fill-primary/12" />
      <path
        d="M24 33s-9-5.5-9-12a5 5 0 019-3 5 5 0 019 3c0 6.5-9 12-9 12z"
        className="fill-primary/30 stroke-primary"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TravelIcon({ className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden>
      <rect x="4" y="8" width="40" height="32" rx="8" className="fill-primary/12" />
      <path d="M14 32l20-9c2-1 3 1 1.5 2.5L26 34l-4-1-2 3-2-1 1-4z" className="fill-primary" />
      <circle cx="24" cy="24" r="13" className="stroke-primary/30" strokeWidth="2" fill="none" />
    </svg>
  );
}

export function UploadStepIcon({ className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden>
      <path d="M20 27V11m0 0l-6 6m6-6l6 6" className="stroke-primary" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 27v3a2 2 0 002 2h20a2 2 0 002-2v-3" className="stroke-primary" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function ExtractStepIcon({ className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden>
      <circle cx="18" cy="18" r="10" className="stroke-primary" strokeWidth="3" fill="none" />
      <path d="M25 25l7 7" className="stroke-primary" strokeWidth="3" strokeLinecap="round" />
      <path d="M14 18h8M18 14v8" className="stroke-primary" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function AnalyzeStepIcon({ className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden>
      <path d="M8 30l7-8 5 4 6-9 6 5" className="stroke-primary" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <circle cx="32" cy="22" r="2.5" className="fill-primary" />
    </svg>
  );
}

export function DecideStepIcon({ className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden>
      <path d="M11 20l6 6 12-13" className="stroke-primary" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

/** Simple stacked-avatars mark for the social-proof row (human, not stock). */
export function AvatarStack({ className = '' }: IconProps) {
  const tones = ['fill-primary/80', 'fill-primary/60', 'fill-primary/40'];
  return (
    <div className={`flex -space-x-2 ${className}`} aria-hidden>
      {tones.map((tone, i) => (
        <svg key={i} viewBox="0 0 40 40" className="h-8 w-8 rounded-full border-2 border-surface bg-surface">
          <circle cx="20" cy="20" r="20" className="fill-surface" />
          <circle cx="20" cy="16" r="7" className={tone} />
          <path d="M8 34c2-7 6-9 12-9s10 2 12 9" className={tone} />
        </svg>
      ))}
    </div>
  );
}
