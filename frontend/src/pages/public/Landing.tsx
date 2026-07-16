import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import {
  HeroArt,
  HealthIcon,
  MotorIcon,
  LifeIcon,
  TravelIcon,
  UploadStepIcon,
  ExtractStepIcon,
  AnalyzeStepIcon,
  DecideStepIcon,
  AvatarStack,
} from '../../components/illustrations';

/**
 * Customer Portal Landing Page (R20).
 *
 * Editorial, illustration-led marketing page. Bespoke inline-SVG artwork
 * (see components/illustrations.tsx) carries the visual weight so the page
 * reads as designed rather than text-dumped. Violet brand accent + Sora /
 * Plus Jakarta Sans type.
 *
 * Retains the mandated functional elements:
 * - R20.2 four-step process (Upload → Extract → Analyze → Decide)
 * - R20.3 coverage types (Health, Motor, Life, Travel) + scanned/typed PDFs
 * - R20.4 "No account needed to preview · Results in under 40 seconds"
 * - R20.6 footer sections: Product, Coverage Types, Company
 * - R20.7 primary CTA into the no-account preview flow
 */

const COVERAGE_TYPES = [
  { name: 'Health', Icon: HealthIcon, blurb: 'Room limits, co-pay, sub-limits and waiting periods, spelled out.' },
  { name: 'Motor', Icon: MotorIcon, blurb: 'Own-damage vs third-party, IDV and the add-ons that matter.' },
  { name: 'Life', Icon: LifeIcon, blurb: 'Sum assured, riders, lapse terms and the exclusions nobody reads.' },
  { name: 'Travel', Icon: TravelIcon, blurb: 'Medical cover, baggage, cancellation and pre-existing rules.' },
] as const;

const STEPS = [
  { step: '01', title: 'Upload', Icon: UploadStepIcon, blurb: 'Drop in any policy PDF — typed or scanned. No sign-up to try it.' },
  { step: '02', title: 'Extract', Icon: ExtractStepIcon, blurb: 'We read every page, including photographed scans, and pull the real terms.' },
  { step: '03', title: 'Analyze', Icon: AnalyzeStepIcon, blurb: 'Coverage, exclusions, waiting periods and buried clauses, scored 0–100.' },
  { step: '04', title: 'Decide', Icon: DecideStepIcon, blurb: 'Straight answers and side-by-side comparisons so the choice is obvious.' },
] as const;

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
      {children}
    </span>
  );
}

function PrimaryCta({ children }: { children: ReactNode }) {
  return (
    <Link
      to="/try"
      className="inline-flex items-center gap-2 rounded-xl bg-primary px-7 py-3.5 text-base font-bold text-white shadow-lg shadow-primary/30 transition hover:opacity-90"
    >
      {children}
      <span aria-hidden>→</span>
    </Link>
  );
}

export function Landing() {
  return (
    <div className="bg-background text-foreground">
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-32 right-0 h-[34rem] w-[34rem] rounded-full bg-primary/15 blur-[130px]"
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-6 pb-16 pt-14 lg:grid-cols-[1.05fr_0.95fr] lg:pt-20">
          {/* copy */}
          <div>
            <Badge>
              <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
              Now reading photographed &amp; scanned policies
            </Badge>

            <h1 className="mt-6 font-display text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
              Know exactly what your insurance{' '}
              <span className="relative whitespace-nowrap text-primary">
                actually covers.
                <svg
                  aria-hidden
                  viewBox="0 0 300 12"
                  preserveAspectRatio="none"
                  className="absolute -bottom-1 left-0 h-2.5 w-full text-primary/40"
                >
                  <path d="M2 8c60-6 236-6 296 0" stroke="currentColor" strokeWidth="4" strokeLinecap="round" fill="none" />
                </svg>
              </span>
            </h1>

            <p className="mt-6 max-w-xl text-lg text-muted">
              Policies are long, dense and easy to misread. Upload yours and get
              a clear, honest breakdown — the coverage, the exclusions, the
              waiting periods and the fine print that changes everything.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <PrimaryCta>Analyze my policy</PrimaryCta>
              <a
                href="#how-it-works"
                className="inline-flex items-center gap-2 rounded-xl border border-border px-7 py-3.5 text-base font-semibold text-foreground transition hover:border-primary hover:text-primary"
              >
                How it works
              </a>
            </div>

            <div className="mt-8 flex items-center gap-3">
              <AvatarStack />
              <p className="text-sm text-muted">
                <span className="font-semibold text-foreground">No account needed to preview</span>{' '}
                · Results in under 40 seconds
              </p>
            </div>
          </div>

          {/* artwork */}
          <div className="relative">
            <div className="mx-auto max-w-md rounded-3xl border border-border bg-surface/60 p-4 shadow-2xl shadow-black/10 backdrop-blur">
              <HeroArt className="w-full text-primary" />
            </div>
          </div>
        </div>
      </section>

      {/* ── Feature previews ─────────────────────────────────────────── */}
      <section id="features" className="mx-auto max-w-6xl px-6 py-16">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-primary">
            What you get back
          </p>
          <h2 className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl">
            The details you&apos;d never scroll to, surfaced for you.
          </h2>
          <p className="mt-4 text-muted">
            Everything below is generated from your own document — never a
            generic template.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          <FeatureCard
            eyebrow="Clause analysis"
            title="Buried exclusions, flagged"
            body="We pull the clauses that quietly deny claims — pre-existing rules, sub-limits, co-pays — and rewrite them in plain English."
            chip="3 risk flags found"
            chipTone="danger"
          />
          <FeatureCard
            eyebrow="Claim simulator"
            title="Would this be paid?"
            body="Describe a scenario and see whether it clears the waiting periods, coverage and exclusions — before you file."
            chip="Waiting period ✓"
            chipTone="ok"
          />
          <FeatureCard
            eyebrow="Side-by-side"
            title="A vs B, settled"
            body="Compare two policies on a single 0–100 health score and see which one genuinely protects you better."
            chip="B scores 86 / A 64"
            chipTone="ok"
          />
          <FeatureCard
            eyebrow="Ask your policy"
            title="Answers with citations"
            body="Type a question in your words. Get a grounded answer with the exact clause it came from — no guessing."
            chip="92% match"
            chipTone="ok"
          />
        </div>
      </section>

      {/* ── Four-step process (R20.2) ────────────────────────────────── */}
      <section id="how-it-works" className="border-y border-border bg-surface/50">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="max-w-2xl">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-primary">
              How it works
            </p>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl">
              From a confusing PDF to a confident decision.
            </h2>
          </div>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <div key={s.step} className="relative rounded-2xl border border-border bg-surface p-6">
                <div className="flex items-center justify-between">
                  <span className="grid h-12 w-12 place-items-center rounded-xl bg-primary/10">
                    <s.Icon className="h-7 w-7" />
                  </span>
                  <span className="font-display text-3xl font-extrabold text-primary/20">
                    {s.step}
                  </span>
                </div>
                <h3 className="mt-4 text-lg font-bold text-foreground">{s.title}</h3>
                <p className="mt-2 text-sm text-muted">{s.blurb}</p>
                {i < STEPS.length - 1 && (
                  <span
                    aria-hidden
                    className="absolute -right-3 top-1/2 hidden -translate-y-1/2 text-2xl text-primary/30 lg:block"
                  >
                    →
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Coverage types (R20.3) ───────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-primary">
              Coverage types
            </p>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl">
              Made for the policies you already hold.
            </h2>
          </div>
          <Badge>Scanned &amp; typed PDFs welcome</Badge>
        </div>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {COVERAGE_TYPES.map((c) => (
            <div
              key={c.name}
              className="group rounded-2xl border border-border bg-surface p-6 transition hover:-translate-y-1 hover:border-primary/40"
            >
              <c.Icon className="h-12 w-12" />
              <h3 className="mt-4 font-display text-xl font-bold text-foreground">
                {c.name}
              </h3>
              <p className="mt-2 text-sm text-muted">{c.blurb}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Human quote block ────────────────────────────────────────── */}
      <section className="mx-auto max-w-4xl px-6 pb-8">
        <figure className="rounded-3xl border border-border bg-surface p-8 sm:p-12">
          <blockquote className="font-display text-2xl font-semibold leading-snug tracking-tight sm:text-3xl">
            &ldquo;I&apos;d been paying for a plan for three years. In 30 seconds
            it showed me the room-rent cap that would&apos;ve gutted any claim.
            I switched that week.&rdquo;
          </blockquote>
          <figcaption className="mt-6 flex items-center gap-3">
            <AvatarStack />
            <div className="text-sm">
              <p className="font-semibold text-foreground">Real reactions from early users</p>
              <p className="text-muted">Names withheld — these are their policies.</p>
            </div>
          </figcaption>
        </figure>
      </section>

      {/* ── Closing CTA ──────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="relative overflow-hidden rounded-3xl border border-primary/30 bg-primary/10 px-6 py-16 text-center">
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-primary/25 blur-[100px]"
          />
          <h2 className="relative font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Stop guessing what you&apos;re actually covered for.
          </h2>
          <p className="relative mt-4 text-muted">
            No account needed to preview · Results in under 40 seconds
          </p>
          <div className="relative mt-8 flex flex-wrap justify-center gap-4">
            <PrimaryCta>Analyze my policy</PrimaryCta>
            <Link
              to="/login"
              className="inline-flex items-center gap-2 rounded-xl border border-border px-7 py-3.5 text-base font-semibold text-foreground transition hover:border-primary hover:text-primary"
            >
              Log in
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer (R20.6) ───────────────────────────────────────────── */}
      <footer className="border-t border-border bg-surface/50">
        <div className="mx-auto max-w-6xl px-6 py-14">
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="font-display text-lg font-bold text-primary">PolicyLens</p>
              <p className="mt-2 text-sm text-muted">
                We read the fine print so you don&apos;t have to.
              </p>
            </div>

            <div>
              <h3 className="text-sm font-bold text-foreground">Product</h3>
              <ul className="mt-3 space-y-2 text-sm text-muted">
                <li><a href="#features" className="hover:text-primary">Features</a></li>
                <li><a href="#how-it-works" className="hover:text-primary">How it works</a></li>
                <li><Link to="/try" className="hover:text-primary">Analyze a policy</Link></li>
              </ul>
            </div>

            <div>
              <h3 className="text-sm font-bold text-foreground">Coverage Types</h3>
              <ul className="mt-3 space-y-2 text-sm text-muted">
                <li><Link to="/try" className="hover:text-primary">Health</Link></li>
                <li><Link to="/try" className="hover:text-primary">Motor</Link></li>
                <li><Link to="/try" className="hover:text-primary">Life</Link></li>
                <li><Link to="/try" className="hover:text-primary">Travel</Link></li>
              </ul>
            </div>

            <div>
              <h3 className="text-sm font-bold text-foreground">Company</h3>
              <ul className="mt-3 space-y-2 text-sm text-muted">
                <li><a href="#about" className="hover:text-primary">About</a></li>
                <li><a href="#privacy" className="hover:text-primary">Privacy</a></li>
                <li><a href="#terms" className="hover:text-primary">Terms</a></li>
              </ul>
            </div>
          </div>

          <div className="mt-12 border-t border-border pt-6 text-xs text-muted">
            Not a substitute for professional insurance advice.
          </div>
        </div>
      </footer>
    </div>
  );
}

/** Compact feature card with an accent chip. */
function FeatureCard({
  eyebrow,
  title,
  body,
  chip,
  chipTone,
}: {
  eyebrow: string;
  title: string;
  body: string;
  chip: string;
  chipTone: 'ok' | 'danger';
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-border bg-surface p-6 transition hover:-translate-y-1 hover:border-primary/40">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
        {eyebrow}
      </p>
      <h3 className="mt-3 font-display text-lg font-bold text-foreground">{title}</h3>
      <p className="mt-2 flex-1 text-sm text-muted">{body}</p>
      <span
        className={`mt-4 inline-flex w-fit items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${
          chipTone === 'danger'
            ? 'bg-danger/15 text-danger'
            : 'bg-primary/10 text-primary'
        }`}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${chipTone === 'danger' ? 'bg-danger' : 'bg-primary'}`}
          aria-hidden
        />
        {chip}
      </span>
    </div>
  );
}

export default Landing;
