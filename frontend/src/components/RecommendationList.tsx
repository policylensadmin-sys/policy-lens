import type { Recommendation } from '@policylens/shared';

/**
 * RecommendationList — up to 5 AI recommendations, each labelled as addressing
 * a coverage gap or a risk flag (R4.4). When the analysis produced no
 * recommendations it renders a positive "no improvement areas" message (R4.6).
 */

/** Maximum recommendations shown on the dashboard (R4.4). */
export const MAX_RECOMMENDATIONS = 5;

interface RecommendationListProps {
  recommendations: Recommendation[];
}

/** Badge label + classes per recommendation kind (R4.4). */
const KIND_META: Record<Recommendation['kind'], { label: string; badge: string }> = {
  gap: { label: 'Coverage gap', badge: 'border-amber-400/50 bg-amber-400/15 text-amber-400' },
  risk: { label: 'Risk flag', badge: 'border-danger/50 bg-danger/15 text-danger' },
};

export function RecommendationList({ recommendations }: RecommendationListProps) {
  // No recommendations → confirmation that there are no improvement areas (R4.6).
  if (recommendations.length === 0) {
    return (
      <p role="status" className="text-sm text-muted">
        This policy has no identified improvement areas.
      </p>
    );
  }

  // Show at most 5 recommendations (R4.4).
  const shown = recommendations.slice(0, MAX_RECOMMENDATIONS);

  return (
    <ul className="flex flex-col gap-3">
      {shown.map((rec, index) => {
        const meta = KIND_META[rec.kind];
        return (
          <li
            key={`${rec.title}-${index}`}
            className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="font-medium text-foreground">{rec.title}</p>
              <span
                className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.badge}`}
              >
                {meta.label}
              </span>
            </div>
            <p className="text-sm text-muted">{rec.detail}</p>
          </li>
        );
      })}
    </ul>
  );
}

export default RecommendationList;
