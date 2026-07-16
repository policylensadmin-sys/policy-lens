import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  Bot,
  Calculator,
  FilePlus2,
  FileText,
  Scale,
  ShieldPlus,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';

/**
 * Quick Actions bar (R14).
 *
 * Renders exactly 8 Quick Action shortcuts (R14.1). Activating an action
 * navigates directly to the relevant workflow (R14.2). At viewports ≥1024px the
 * 8 actions lay out on a single row so the section is visible without scrolling
 * (R14.3). Actions that declare an unmet prerequisite show an inline message
 * instead of navigating to an empty workflow (R14.4).
 */
interface QuickActionsBarProps {
  /** Active policy count — gates policy-dependent actions (R14.4). */
  activePolicies: number;
  /** Renewals due in the next 30 days — gates the reminder action (R14.4). */
  renewalsDue: number;
}

interface QuickAction {
  id: string;
  label: string;
  icon: LucideIcon;
  to: string;
  /** Returns an error message when the prerequisite is unmet, else null. */
  prerequisite?: (ctx: QuickActionsBarProps) => string | null;
}

/** The 8 Quick Actions, in the order required by R14.1. */
const QUICK_ACTIONS: QuickAction[] = [
  { id: 'add-client', label: 'Add Client', icon: UserPlus, to: '/broker/clients?action=add' },
  { id: 'add-policy', label: 'Add Policy', icon: FilePlus2, to: '/broker/policies?action=add' },
  {
    id: 'compare-policies',
    label: 'Compare Policies',
    icon: Scale,
    to: '/broker/policies?action=compare',
    prerequisite: ({ activePolicies }) =>
      activePolicies >= 2
        ? null
        : 'Compare Policies needs at least two policies. Add more policies first.',
  },
  {
    id: 'ai-policy-analysis',
    label: 'AI Policy Analysis',
    icon: Bot,
    to: '/broker/ai-assistant',
    prerequisite: ({ activePolicies }) =>
      activePolicies >= 1
        ? null
        : 'AI Policy Analysis needs at least one policy. Add a policy first.',
  },
  { id: 'premium-calculator', label: 'Premium Calculator', icon: Calculator, to: '/broker/premiums?tool=calculator' },
  { id: 'generate-report', label: 'Generate Report', icon: FileText, to: '/broker/reports?action=generate' },
  {
    id: 'send-renewal-reminders',
    label: 'Send Renewal Reminders',
    icon: Bell,
    to: '/broker/renewals?action=remind',
    prerequisite: ({ renewalsDue }) =>
      renewalsDue >= 1
        ? null
        : 'No renewals are due in the next 30 days, so there are no reminders to send.',
  },
  {
    id: 'claim-assistant',
    label: 'Claim Assistant',
    icon: ShieldPlus,
    to: '/broker/claims?action=new',
    prerequisite: ({ activePolicies }) =>
      activePolicies >= 1
        ? null
        : 'Claim Assistant needs at least one policy on file. Add a policy first.',
  },
];

export function QuickActionsBar(props: QuickActionsBarProps) {
  const navigate = useNavigate();
  const [message, setMessage] = useState<string | null>(null);

  const handleClick = (action: QuickAction) => {
    const unmet = action.prerequisite?.(props) ?? null;
    if (unmet) {
      setMessage(unmet);
      return;
    }
    setMessage(null);
    navigate(action.to);
  };

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="font-display text-sm font-semibold text-slate-900">
        Quick Actions
      </h2>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.id}
            type="button"
            onClick={() => handleClick(action)}
            className="flex flex-col items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-center text-xs font-medium text-slate-700 transition-colors hover:border-[#2563EB] hover:bg-blue-50 hover:text-[#2563EB]"
          >
            <action.icon aria-hidden size={20} strokeWidth={1.75} />
            <span>{action.label}</span>
          </button>
        ))}
      </div>

      {message && (
        <p
          role="alert"
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700"
        >
          {message}
        </p>
      )}
    </section>
  );
}

export default QuickActionsBar;
