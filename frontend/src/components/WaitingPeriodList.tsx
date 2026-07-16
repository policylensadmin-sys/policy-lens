import { useMemo } from 'react';
import type { WaitingPeriod } from '@policylens/shared';

/**
 * WaitingPeriodList — waiting periods grouped by their stated duration (R4.1).
 *
 * Multiple conditions frequently share the same waiting period (e.g. a "2 years"
 * wait applying to several treatments), so entries are grouped by `duration`
 * and each group lists the conditions/treatments it applies to.
 */

interface WaitingPeriodListProps {
  waitingPeriods: WaitingPeriod[];
  /** Message shown when no waiting periods were identified (R3.9). */
  emptyMessage?: string;
}

export function WaitingPeriodList({
  waitingPeriods,
  emptyMessage = 'No waiting periods were identified in this policy.',
}: WaitingPeriodListProps) {
  // Group the flat list by duration, preserving first-seen order (R4.1).
  const groups = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const wp of waitingPeriods) {
      const existing = map.get(wp.duration);
      if (existing) {
        existing.push(wp.appliesTo);
      } else {
        map.set(wp.duration, [wp.appliesTo]);
      }
    }
    return Array.from(map, ([duration, appliesTo]) => ({ duration, appliesTo }));
  }, [waitingPeriods]);

  if (groups.length === 0) {
    return <p className="text-sm text-muted">{emptyMessage}</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {groups.map((group) => (
        <li
          key={group.duration}
          className="rounded-lg border border-border bg-background/40 px-3 py-3"
        >
          <p className="font-display text-base text-accent">{group.duration}</p>
          <ul className="mt-1 flex flex-col gap-1">
            {group.appliesTo.map((condition, index) => (
              <li key={`${group.duration}-${index}`} className="text-sm text-muted">
                {condition}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

export default WaitingPeriodList;
