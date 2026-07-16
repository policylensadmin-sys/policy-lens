// Demo seed script.
//
// Populates a self-contained demo broker so the Broker Portal is immediately
// usable for demos: one broker (with an auth user + profile), several clients,
// broker policies, renewals, commissions, claims, and leads.
//
// It uses the Supabase service-role client, which bypasses RLS and can create
// the auth user via the admin API. The broker/client tables ultimately depend
// on `profiles`, which is provisioned from `auth.users` by the signup trigger
// (see 002_profiles.sql), so an auth user is required before broker data exists.
//
// The seed is idempotent:
//   • the demo auth user is created only if it does not already exist
//   • every domain row uses a fixed UUID and is written with `upsert` on `id`
// so re-running converges to the same state without duplicating data.
//
// Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. A missing credential is
// surfaced as a clear runtime error (no live services are needed to type-check).

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import 'dotenv/config';
import type { SupabaseClient, User } from '@supabase/supabase-js';

import { config } from '../config/index';
import { getSupabaseServiceRoleClient } from '../lib/supabase';

// --- Demo identity ----------------------------------------------------------
const DEMO_BROKER_EMAIL = 'demo.broker@policylens.dev';
const DEMO_BROKER_PASSWORD = 'DemoBroker!2024';
const DEMO_BROKER_NAME = 'Asha Menon';
const DEMO_AGENCY = 'Meridian Insurance Advisors';

// --- Deterministic IDs (fixed so upserts are idempotent) --------------------
const BROKER_ID = '11111111-1111-4111-8111-111111111111';

const CLIENT_IDS = {
  raviKumar: '22222222-2222-4222-8222-000000000001',
  priyaSharma: '22222222-2222-4222-8222-000000000002',
  arjunNair: '22222222-2222-4222-8222-000000000003',
  meeraIyer: '22222222-2222-4222-8222-000000000004',
} as const;

const POLICY_IDS = {
  raviHealth: '33333333-3333-4333-8333-000000000001',
  raviMotor: '33333333-3333-4333-8333-000000000002',
  priyaHealth: '33333333-3333-4333-8333-000000000003',
  arjunTravel: '33333333-3333-4333-8333-000000000004',
  meeraHealth: '33333333-3333-4333-8333-000000000005',
  meeraLife: '33333333-3333-4333-8333-000000000006',
} as const;

const RENEWAL_IDS = {
  raviHealth: '44444444-4444-4444-8444-000000000001',
  priyaHealth: '44444444-4444-4444-8444-000000000002',
  meeraHealth: '44444444-4444-4444-8444-000000000003',
} as const;

const COMMISSION_IDS = {
  raviHealth: '55555555-5555-4555-8555-000000000001',
  raviMotor: '55555555-5555-4555-8555-000000000002',
  priyaHealth: '55555555-5555-4555-8555-000000000003',
  arjunTravel: '55555555-5555-4555-8555-000000000004',
  meeraHealth: '55555555-5555-4555-8555-000000000005',
  meeraLife: '55555555-5555-4555-8555-000000000006',
} as const;

const CLAIM_IDS = {
  raviHealth: '66666666-6666-4666-8666-000000000001',
  meeraHealth: '66666666-6666-4666-8666-000000000002',
} as const;

const LEAD_IDS = {
  one: '77777777-7777-4777-8777-000000000001',
  two: '77777777-7777-4777-8777-000000000002',
  three: '77777777-7777-4777-8777-000000000003',
} as const;

// --- Date helpers (relative to now, so the demo always looks current) -------
function isoDate(daysFromNow: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

function isoTimestamp(daysFromNow: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString();
}

/** Throw a clear error if the required Supabase service-role credentials are absent. */
function assertServiceRoleConfigured(): void {
  const { url, serviceRoleKey } = config.supabase;
  if (!url || !serviceRoleKey) {
    throw new Error(
      'Seeding requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to be set. ' +
        'Set them in your .env (the service-role key is server-only) and retry.',
    );
  }
}

/** Find an existing auth user by email, paging through the admin user list. */
async function findUserByEmail(supabase: SupabaseClient, email: string): Promise<User | undefined> {
  const target = email.toLowerCase();
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Failed to list auth users: ${error.message}`);
    const match = data.users.find((u) => (u.email ?? '').toLowerCase() === target);
    if (match) return match;
    if (data.users.length < 200) break; // last page reached
  }
  return undefined;
}

/** Create (or reuse) the demo broker auth user and return its id. */
async function ensureDemoBrokerUser(supabase: SupabaseClient): Promise<string> {
  const existing = await findUserByEmail(supabase, DEMO_BROKER_EMAIL);
  if (existing) {
    console.log('  ↳ auth user already exists, reusing');
    return existing.id;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email: DEMO_BROKER_EMAIL,
    password: DEMO_BROKER_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: DEMO_BROKER_NAME, role: 'broker' },
  });
  if (error || !data.user) {
    throw new Error(`Failed to create demo broker user: ${error?.message ?? 'unknown error'}`);
  }
  console.log('  ↳ created demo broker auth user');
  return data.user.id;
}

/** Fetch the profile id for an auth user; ensure it is a broker-role profile. */
async function ensureBrokerProfile(supabase: SupabaseClient, userId: string): Promise<string> {
  // The signup trigger provisions the profile row asynchronously; poll briefly.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, role')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(`Failed to read demo profile: ${error.message}`);

    if (data) {
      if (data.role !== 'broker') {
        const { error: updErr } = await supabase
          .from('profiles')
          .update({ role: 'broker', full_name: DEMO_BROKER_NAME })
          .eq('id', data.id);
        if (updErr) throw new Error(`Failed to set profile role: ${updErr.message}`);
      }
      return data.id as string;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Demo profile row was not created by the signup trigger in time.');
}

/** Upsert a batch into a table on the `id` conflict target, or throw. */
async function upsert(
  supabase: SupabaseClient,
  table: string,
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  const { error } = await supabase.from(table).upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(`Failed to upsert into ${table}: ${error.message}`);
  console.log(`  ↳ upserted ${rows.length} row(s) into ${table}`);
}

async function seedBrokerDomain(supabase: SupabaseClient, profileId: string): Promise<void> {
  await upsert(supabase, 'brokers', [
    {
      id: BROKER_ID,
      profile_id: profileId,
      agency_name: DEMO_AGENCY,
      plan: 'pro',
      currency: 'INR',
    },
  ]);

  await upsert(supabase, 'clients', [
    {
      id: CLIENT_IDS.raviKumar,
      broker_id: BROKER_ID,
      full_name: 'Ravi Kumar',
      email: 'ravi.kumar@example.com',
      phone: '+91 98200 11111',
      risk_flags: ['high_deductible'],
    },
    {
      id: CLIENT_IDS.priyaSharma,
      broker_id: BROKER_ID,
      full_name: 'Priya Sharma',
      email: 'priya.sharma@example.com',
      phone: '+91 98200 22222',
      risk_flags: ['missing_family_coverage'],
    },
    {
      id: CLIENT_IDS.arjunNair,
      broker_id: BROKER_ID,
      full_name: 'Arjun Nair',
      email: 'arjun.nair@example.com',
      phone: '+91 98200 33333',
      risk_flags: [],
    },
    {
      id: CLIENT_IDS.meeraIyer,
      broker_id: BROKER_ID,
      full_name: 'Meera Iyer',
      email: 'meera.iyer@example.com',
      phone: '+91 98200 44444',
      risk_flags: ['underinsured', 'no_health_insurance'],
    },
  ]);

  await upsert(supabase, 'broker_policies', [
    {
      id: POLICY_IDS.raviHealth,
      broker_id: BROKER_ID,
      client_id: CLIENT_IDS.raviKumar,
      policy_type: 'health',
      insurer: 'Star Health',
      start_date: isoDate(-320),
      end_date: isoDate(20), // renewal due within 30d
      premium_amount: 24000,
      payment_frequency: 'annual',
      status: 'pending_renewal',
      sum_insured: 500000,
      deductible: 60000,
    },
    {
      id: POLICY_IDS.raviMotor,
      broker_id: BROKER_ID,
      client_id: CLIENT_IDS.raviKumar,
      policy_type: 'motor',
      insurer: 'ICICI Lombard',
      start_date: isoDate(-120),
      end_date: isoDate(245),
      premium_amount: 18500,
      payment_frequency: 'annual',
      status: 'active',
      sum_insured: 800000,
      deductible: 5000,
    },
    {
      id: POLICY_IDS.priyaHealth,
      broker_id: BROKER_ID,
      client_id: CLIENT_IDS.priyaSharma,
      policy_type: 'health',
      insurer: 'HDFC Ergo',
      start_date: isoDate(-280),
      end_date: isoDate(60), // renewal due within 90d
      premium_amount: 32000,
      payment_frequency: 'annual',
      status: 'active',
      sum_insured: 1000000,
      deductible: 25000,
    },
    {
      id: POLICY_IDS.arjunTravel,
      broker_id: BROKER_ID,
      client_id: CLIENT_IDS.arjunNair,
      policy_type: 'travel',
      insurer: 'Tata AIG',
      start_date: isoDate(-30),
      end_date: isoDate(-2), // expired
      premium_amount: 4500,
      payment_frequency: 'one_time',
      status: 'expired',
      sum_insured: 200000,
      deductible: 0,
    },
    {
      id: POLICY_IDS.meeraHealth,
      broker_id: BROKER_ID,
      client_id: CLIENT_IDS.meeraIyer,
      policy_type: 'health',
      insurer: 'Niva Bupa',
      start_date: isoDate(-350),
      end_date: isoDate(12), // renewal due within 30d
      premium_amount: 28000,
      payment_frequency: 'annual',
      status: 'pending_renewal',
      sum_insured: 300000,
      deductible: 40000,
    },
    {
      id: POLICY_IDS.meeraLife,
      broker_id: BROKER_ID,
      client_id: CLIENT_IDS.meeraIyer,
      policy_type: 'life',
      insurer: 'LIC',
      start_date: isoDate(-800),
      end_date: isoDate(4000),
      premium_amount: 45000,
      payment_frequency: 'annual',
      status: 'active',
      sum_insured: 5000000,
      deductible: 0,
    },
  ]);

  await upsert(supabase, 'renewals', [
    {
      id: RENEWAL_IDS.raviHealth,
      broker_policy_id: POLICY_IDS.raviHealth,
      renewal_date: isoDate(20),
      premium_amount: 25200,
      reminder_sent: false,
    },
    {
      id: RENEWAL_IDS.priyaHealth,
      broker_policy_id: POLICY_IDS.priyaHealth,
      renewal_date: isoDate(60),
      premium_amount: 33600,
      reminder_sent: false,
    },
    {
      id: RENEWAL_IDS.meeraHealth,
      broker_policy_id: POLICY_IDS.meeraHealth,
      renewal_date: isoDate(12),
      premium_amount: 29400,
      reminder_sent: true,
    },
  ]);

  await upsert(supabase, 'commissions', [
    {
      id: COMMISSION_IDS.raviHealth,
      broker_policy_id: POLICY_IDS.raviHealth,
      amount: 2400,
      status: 'paid',
      scheduled_date: isoDate(-300),
      paid_date: isoDate(-295),
    },
    {
      id: COMMISSION_IDS.raviMotor,
      broker_policy_id: POLICY_IDS.raviMotor,
      amount: 1850,
      status: 'paid',
      scheduled_date: isoDate(-110),
      paid_date: isoDate(-100),
    },
    {
      id: COMMISSION_IDS.priyaHealth,
      broker_policy_id: POLICY_IDS.priyaHealth,
      amount: 3200,
      status: 'pending',
      scheduled_date: isoDate(15),
      paid_date: null,
    },
    {
      id: COMMISSION_IDS.arjunTravel,
      broker_policy_id: POLICY_IDS.arjunTravel,
      amount: 450,
      status: 'overdue',
      scheduled_date: isoDate(-20),
      paid_date: null,
    },
    {
      id: COMMISSION_IDS.meeraHealth,
      broker_policy_id: POLICY_IDS.meeraHealth,
      amount: 2800,
      status: 'pending',
      scheduled_date: isoDate(10),
      paid_date: null,
    },
    {
      id: COMMISSION_IDS.meeraLife,
      broker_policy_id: POLICY_IDS.meeraLife,
      amount: 4500,
      status: 'paid',
      scheduled_date: isoDate(-30),
      paid_date: isoDate(-25),
    },
  ]);

  await upsert(supabase, 'claims', [
    {
      id: CLAIM_IDS.raviHealth,
      broker_policy_id: POLICY_IDS.raviHealth,
      client_id: CLIENT_IDS.raviKumar,
      claim_type: 'hospitalization',
      claimed_amount: 85000,
      status: 'under_review',
      submitted_at: isoTimestamp(-6),
    },
    {
      id: CLAIM_IDS.meeraHealth,
      broker_policy_id: POLICY_IDS.meeraHealth,
      client_id: CLIENT_IDS.meeraIyer,
      claim_type: 'day_care',
      claimed_amount: 22000,
      status: 'approved',
      submitted_at: isoTimestamp(-40),
    },
  ]);

  await upsert(supabase, 'leads', [
    {
      id: LEAD_IDS.one,
      broker_id: BROKER_ID,
      name: 'Sanjay Gupta',
      contact: 'sanjay.gupta@example.com',
      stage: 'new',
      notes: 'Referred by Ravi Kumar; interested in family floater health cover.',
    },
    {
      id: LEAD_IDS.two,
      broker_id: BROKER_ID,
      name: 'Neha Verma',
      contact: '+91 98765 55555',
      stage: 'contacted',
      notes: 'Looking for term life insurance, follow up next week.',
    },
    {
      id: LEAD_IDS.three,
      broker_id: BROKER_ID,
      name: 'Kabir Singh',
      contact: 'kabir.singh@example.com',
      stage: 'qualified',
      notes: 'Comparing motor insurance quotes; send proposal.',
    },
  ]);
}

export async function runSeed(): Promise<void> {
  assertServiceRoleConfigured();
  const supabase = getSupabaseServiceRoleClient();

  console.log('[seed] ensuring demo broker auth user…');
  const userId = await ensureDemoBrokerUser(supabase);
  const profileId = await ensureBrokerProfile(supabase, userId);

  console.log('[seed] seeding broker domain data…');
  await seedBrokerDomain(supabase, profileId);
}

async function main(): Promise<void> {
  await runSeed();
  console.log(
    `[seed] done — demo broker ready. Sign in as ${DEMO_BROKER_EMAIL} / ${DEMO_BROKER_PASSWORD}`,
  );
}

// Run only when executed directly (not when imported by tests).
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
const thisPath = resolve(fileURLToPath(import.meta.url));
if (invokedPath === thisPath) {
  main().catch((err: unknown) => {
    console.error(`[seed] ${(err as Error).message}`);
    process.exitCode = 1;
  });
}
