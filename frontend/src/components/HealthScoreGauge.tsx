/**
 * HealthScoreGauge — numeric Health Score (0–100) with a quality-band visual
 * indicator (R4.3).
 *
 * The score is mapped to one of four quality bands:
 *   0–40 Poor · 41–60 Fair · 61–80 Good · 81–100 Excellent
 *
 * The band drives the gauge colour and label. The gauge itself is a radial SVG
 * arc so the reading is legible at a glance above the fold on the dashboard.
 */

/** A Health Score quality band (R4.3). */
export interface QualityBand {
  label: 'Poor' | 'Fair' | 'Good' | 'Excellent';
  /** Tailwind text colour class for the band. */
  textClass: string;
  /** RGB stroke colour for the gauge arc. */
  stroke: string;
}

/**
 * Map a 0–100 Health Score to its quality band (R4.3). The score is clamped to
 * the valid range so out-of-range inputs still resolve to a band.
 */
export function qualityBand(score: number): QualityBand {
  const clamped = Math.min(Math.max(score, 0), 100);
  if (clamped <= 40) {
    return { label: 'Poor', textClass: 'text-danger', stroke: 'rgb(239 68 68)' };
  }
  if (clamped <= 60) {
    return { label: 'Fair', textClass: 'text-amber-400', stroke: 'rgb(251 191 36)' };
  }
  if (clamped <= 80) {
    return { label: 'Good', textClass: 'text-accent', stroke: 'rgb(45 212 191)' };
  }
  return { label: 'Excellent', textClass: 'text-emerald-400', stroke: 'rgb(52 211 153)' };
}

interface HealthScoreGaugeProps {
  /** The computed Health Score in [0, 100]. */
  score: number;
}

/** Geometry for the radial gauge arc. */
const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function HealthScoreGauge({ score }: HealthScoreGaugeProps) {
  const clamped = Math.min(Math.max(Math.round(score), 0), 100);
  const band = qualityBand(clamped);
  // Show ~75% of the circle as the track; fill proportional to the score.
  const dash = (clamped / 100) * CIRCUMFERENCE;

  return (
    <div
      className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface p-6"
      role="group"
      aria-label={`Health Score ${clamped} out of 100, rated ${band.label}`}
    >
      <h2 className="font-display text-sm uppercase tracking-wide text-muted">Health Score</h2>
      <div className="relative h-36 w-36">
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
          <circle
            cx="60"
            cy="60"
            r={RADIUS}
            fill="none"
            stroke="rgb(30 41 59)"
            strokeWidth="10"
          />
          <circle
            cx="60"
            cy="60"
            r={RADIUS}
            fill="none"
            stroke={band.stroke}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${CIRCUMFERENCE}`}
            className="transition-all"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-4xl text-foreground">{clamped}</span>
          <span className="text-xs text-muted">/ 100</span>
        </div>
      </div>
      <span className={`font-display text-lg ${band.textClass}`}>{band.label}</span>
    </div>
  );
}

export default HealthScoreGauge;
