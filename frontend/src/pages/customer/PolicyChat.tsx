import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChatPanel } from '../../components/ChatPanel';
import { SearchResults } from '../../components/SearchResults';
import { LensSparkle } from '../../components/Brand';

/**
 * Policy Chat page (R5, R15).
 *
 * Scoped to a single policy via the `:id` route param. Presents two tabs:
 * - **Ask** — the {@link ChatPanel} conversational Q&A grounded in the policy
 *   with cited-clause chips (R5).
 * - **Search** — the {@link SearchResults} semantic search over the policy's
 *   clauses, ranked by match % (R15).
 *
 * Wired to `/app/policy/:id/chat`.
 */

type Tab = 'chat' | 'search';

export function PolicyChat() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<Tab>('chat');

  // Defensive guard: the route always supplies :id, but keep the UI safe.
  if (!id) {
    return (
      <section className="mx-auto max-w-3xl">
        <p role="alert" className="text-sm text-muted">
          No policy selected.
        </p>
      </section>
    );
  }

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link
          to={`/app/policy/${id}`}
          className="text-sm text-muted transition hover:text-accent"
        >
          ← Back to policy dashboard
        </Link>
        <h1 className="inline-flex items-center gap-2 font-display text-2xl text-foreground">
          <LensSparkle className="h-6 w-6" />
          Ask Lens
        </h1>
        <p className="text-sm text-muted">
          Lens is your AI assistant — get plain-English answers grounded in your
          document, or search for specific clauses.
        </p>
      </header>

      {/* Tab switcher */}
      <div role="tablist" aria-label="Policy tools" className="flex gap-2 border-b border-border">
        <TabButton
          label="Ask"
          isActive={tab === 'chat'}
          onClick={() => setTab('chat')}
        />
        <TabButton
          label="Search"
          isActive={tab === 'search'}
          onClick={() => setTab('search')}
        />
      </div>

      {tab === 'chat' ? (
        <div role="tabpanel" aria-label="Ask">
          <ChatPanel policyId={id} />
        </div>
      ) : (
        <div role="tabpanel" aria-label="Search">
          <SearchResults policyId={id} />
        </div>
      )}
    </section>
  );
}

interface TabButtonProps {
  label: string;
  isActive: boolean;
  onClick: () => void;
}

function TabButton({ label, isActive, onClick }: TabButtonProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      onClick={onClick}
      className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
        isActive
          ? 'border-accent text-accent'
          : 'border-transparent text-muted hover:text-foreground'
      }`}
    >
      {label}
    </button>
  );
}

export default PolicyChat;
