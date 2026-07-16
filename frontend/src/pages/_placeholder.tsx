/**
 * Temporary placeholder page factory.
 *
 * Real pages are implemented in tasks 11.x (customer) and 12.x (broker). Until
 * then these lightweight stubs let the route table compile and render so the
 * routing/guard/theming wiring (task 10.3) can be exercised end-to-end.
 */
export function Placeholder({ title }: { title: string }) {
  return (
    <section className="space-y-2">
      <h1 className="font-display text-2xl text-accent">{title}</h1>
      <p className="text-muted">This page is coming soon.</p>
    </section>
  );
}

/** Convenience helper to build a placeholder element for a given title. */
export function makePlaceholder(title: string) {
  return <Placeholder title={title} />;
}

/** Shown when an authenticated user hits a portal their role can't access. */
export function NotAuthorized() {
  return (
    <section className="flex min-h-screen flex-col items-center justify-center gap-2 p-6 text-center">
      <h1 className="font-display text-2xl text-accent">Not authorized</h1>
      <p className="text-muted">You don&apos;t have access to this area.</p>
    </section>
  );
}

export default Placeholder;
