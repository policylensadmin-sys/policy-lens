// BrokerPolicyService — broker policy CRUD, renewals, and premium tracker (R11).
//
// Owns the Supabase reads/writes behind the `/api/broker/policies`,
// `/api/broker/renewals`, and `/api/broker/premiums` surfaces and composes the
// pure rules in `brokerPolicyLogic` for status derivation, validation, renewal
// windows, reminder planning, and premium aggregation. All access is scoped to
// the caller's broker so a broker only ever sees or mutates their own policies
// (broker_id scoping mirrors the RLS policy).
//
// Endpoints served (via brokerPolicyController):
//   • GET  /broker/policies         — paginated list (≤50/page) w/ derived status (R11.1)
//   • POST /broker/policies         — add policy (validation → 422, R11.1/R11.6)
//   • PUT  /broker/policies/:id      — edit policy (validation → 422, R11.1/R11.6)
//   • GET  /broker/renewals          — renewal calendar (≤90d, <30d flag, R11.2/R11.3)
//   • POST /broker/renewals/remind   — send reminders + summary (R11.5/R11.7)
//   • GET  /broker/premiums          — premium tracker (R11.4)
//
// The service resolves the service-role client lazily so the module imports
// cleanly in mock/dev mode without Supabase credentials.

import type { SupabaseClient } from '@supabase/supabase-js';

import { getSupabaseServiceRoleClient } from '../../lib/supabase';
import { AppError } from '../../middleware/errorHandler';
import {
  classifyRenewal,
  computePremiumTracker,
  derivePolicyStatus,
  normalizeReminderWindow,
  pageBounds,
  planRenewalReminders,
  toNumber,
  totalPages,
  validateNewPolicy,
  validatePolicyEdit,
  type EditPolicyInput,
  type NewPolicyInput,
  type PolicyDisplayStatus,
  type PremiumTracker,
  type ReminderCandidate,
  type ReminderPlan,
} from './brokerPolicyLogic';

/** A policy row as returned in list/detail payloads (camel-cased). */
export interface PolicyView {
  id: string;
  clientId: string;
  clientName: string | null;
  policyType: string;
  insurer: string | null;
  startDate: string | null;
  endDate: string | null;
  premiumAmount: number | null;
  paymentFrequency: string | null;
  sumInsured: number | null;
  deductible: number | null;
  /** Derived display status (Active | Pending Renewal | Expired | Cancelled). */
  status: PolicyDisplayStatus;
  /** Stored enum status, preserved for reference. */
  storedStatus: string;
}

/** A paginated list of policies (≤50 per page, R11.1). */
export interface PolicyPage {
  policies: PolicyView[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

/** One entry in the renewal calendar (R11.2/R11.3). */
export interface RenewalCalendarEntry {
  renewalId: string;
  policyId: string;
  clientId: string;
  clientName: string | null;
  policyType: string | null;
  insurer: string | null;
  renewalDate: string | null;
  premiumAmount: number | null;
  daysUntil: number | null;
  /** True when due within 30 days — distinct calendar indicator (R11.3). */
  dueSoon: boolean;
}

/** Renewal calendar payload split into the two indicator bands (R11.2/R11.3). */
export interface RenewalCalendar {
  windowDays: number;
  dueSoonDays: number;
  entries: RenewalCalendarEntry[];
}

/** Confirmation summary for a reminder run (R11.5/R11.7). */
export interface ReminderSummary {
  windowDays: number;
  sentCount: number;
  failed: ReminderPlan['failed'];
}

/** Raw nested policy row returned by Supabase (with its client). */
interface PolicyRow {
  id: string;
  broker_id: string;
  client_id: string;
  policy_type: string;
  insurer: string | null;
  start_date: string | null;
  end_date: string | null;
  premium_amount: number | string | null;
  payment_frequency: string | null;
  status: string;
  sum_insured: number | string | null;
  deductible: number | string | null;
  clients?: { full_name: string | null } | null;
}

/** Nested renewal row joined via its broker policy + client. */
interface RenewalJoinRow {
  id: string;
  renewal_date: string | null;
  premium_amount: number | string | null;
  reminder_sent: boolean;
  broker_policies?: {
    id: string;
    broker_id: string;
    policy_type: string | null;
    insurer: string | null;
    client_id: string;
    clients?: { full_name: string | null; email: string | null; phone: string | null } | null;
  } | null;
}

const POLICY_SELECT =
  'id, broker_id, client_id, policy_type, insurer, start_date, end_date, premium_amount, ' +
  'payment_frequency, status, sum_insured, deductible, clients (full_name)';

const RENEWAL_SELECT =
  'id, renewal_date, premium_amount, reminder_sent, broker_policies!inner (id, broker_id, ' +
  'policy_type, insurer, client_id, clients (full_name, email, phone))';

/** Owns broker policy management, renewals, and premium tracking (R11). */
export class BrokerPolicyService {
  private client?: SupabaseClient;

  constructor(client?: SupabaseClient) {
    this.client = client;
  }

  private db(): SupabaseClient {
    if (!this.client) this.client = getSupabaseServiceRoleClient();
    return this.client;
  }

  /**
   * Resolve the broker id for the authenticated auth user id. Walks
   * `profiles.user_id → profiles.id → brokers.profile_id → brokers.id`.
   * Throws `403` if the user has no broker account.
   */
  async resolveBrokerId(userId: string): Promise<string> {
    const db = this.db();

    const { data: profile, error: profileError } = await db
      .from('profiles')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();
    if (profileError || !profile?.id) {
      throw AppError.forbidden('No profile found for the authenticated user');
    }

    const { data: broker, error: brokerError } = await db
      .from('brokers')
      .select('id')
      .eq('profile_id', profile.id as string)
      .maybeSingle();
    if (brokerError || !broker?.id) {
      throw AppError.forbidden('No broker account is associated with this user');
    }

    return broker.id as string;
  }

  /**
   * List a broker's policies, paginated at ≤50 per page (R11.1). Each policy
   * carries a derived display status. Ordered by start date (newest first).
   */
  async listPolicies(
    brokerId: string,
    options: { page?: unknown } = {},
    now: Date = new Date(),
  ): Promise<PolicyPage> {
    const bounds = pageBounds(options.page);

    const { data, error, count } = await this.db()
      .from('broker_policies')
      .select(POLICY_SELECT, { count: 'exact' })
      .eq('broker_id', brokerId)
      .order('start_date', { ascending: false, nullsFirst: false })
      .order('id', { ascending: true })
      .range(bounds.from, bounds.to);

    if (error) {
      throw AppError.internal('Failed to load policies', { reason: error.message });
    }

    const rows = (data ?? []) as unknown as PolicyRow[];
    const totalCount = count ?? rows.length;

    return {
      policies: rows.map((row) => this.mapPolicy(row, now)),
      page: bounds.page,
      pageSize: bounds.pageSize,
      totalCount,
      totalPages: totalPages(totalCount, bounds.pageSize),
    };
  }

  /**
   * Create a policy with the required fields (R11.1). Validates first, raising
   * `422` naming the missing fields and/or the end-before-start failure so the
   * client can preserve the entered data (R11.6). The referenced client must
   * belong to this broker.
   */
  async createPolicy(brokerId: string, body: NewPolicyInput, now: Date = new Date()): Promise<PolicyView> {
    const validation = validateNewPolicy(body);
    if (!validation.valid) {
      throw AppError.unprocessable('Policy validation failed', {
        missingFields: validation.missingFields,
        endDateBeforeStart: validation.endDateBeforeStart,
      });
    }

    const clientId = (body.clientId as string).trim();
    await this.assertClientOwned(brokerId, clientId);

    const { data, error } = await this.db()
      .from('broker_policies')
      .insert({
        broker_id: brokerId,
        client_id: clientId,
        policy_type: (body.policyType as string).trim(),
        insurer: normalizeOptionalString(body.insurer),
        start_date: normalizeOptionalString(body.startDate),
        end_date: normalizeOptionalString(body.endDate),
        premium_amount: normalizeOptionalNumber(body.premiumAmount),
        payment_frequency: normalizeOptionalString(body.paymentFrequency),
        sum_insured: normalizeOptionalNumber(body.sumInsured),
        deductible: normalizeOptionalNumber(body.deductible),
      })
      .select('id')
      .single();

    if (error || !data?.id) {
      throw AppError.internal('Failed to create policy', { reason: error?.message });
    }

    return this.getPolicy(brokerId, data.id as string, now);
  }

  /**
   * Edit a policy's fields (R11.1). Loads the current record, validates the
   * merged result still satisfies every required field and date-ordering rule
   * (`422` otherwise, R11.6), then applies the patch.
   */
  async updatePolicy(
    brokerId: string,
    policyId: string,
    patch: EditPolicyInput,
    now: Date = new Date(),
  ): Promise<PolicyView> {
    const db = this.db();

    const { data: existing, error: existingError } = await db
      .from('broker_policies')
      .select(
        'id, client_id, policy_type, insurer, start_date, end_date, premium_amount, payment_frequency, status',
      )
      .eq('broker_id', brokerId)
      .eq('id', policyId)
      .maybeSingle();

    if (existingError) {
      throw AppError.internal('Failed to load policy', { reason: existingError.message });
    }
    if (!existing) {
      throw AppError.notFound('Policy not found');
    }

    const validation = validatePolicyEdit(
      {
        clientId: existing.client_id as string,
        policyType: existing.policy_type as string,
        insurer: (existing.insurer as string | null) ?? null,
        startDate: (existing.start_date as string | null) ?? null,
        endDate: (existing.end_date as string | null) ?? null,
        premiumAmount:
          existing.premium_amount === null ? null : toNumber(existing.premium_amount as number | string),
        paymentFrequency: (existing.payment_frequency as string | null) ?? null,
      },
      patch,
    );
    if (!validation.valid) {
      throw AppError.unprocessable('Policy validation failed', {
        missingFields: validation.missingFields,
        endDateBeforeStart: validation.endDateBeforeStart,
      });
    }

    // If the client is being reassigned, ensure the target belongs to this broker.
    if (patch.clientId !== undefined) {
      await this.assertClientOwned(brokerId, (patch.clientId as string).trim());
    }

    const update: Record<string, unknown> = {};
    if (patch.clientId !== undefined) update.client_id = (patch.clientId as string).trim();
    if (patch.policyType !== undefined) update.policy_type = (patch.policyType as string).trim();
    if (patch.insurer !== undefined) update.insurer = normalizeOptionalString(patch.insurer);
    if (patch.startDate !== undefined) update.start_date = normalizeOptionalString(patch.startDate);
    if (patch.endDate !== undefined) update.end_date = normalizeOptionalString(patch.endDate);
    if (patch.premiumAmount !== undefined) {
      update.premium_amount = normalizeOptionalNumber(patch.premiumAmount);
    }
    if (patch.paymentFrequency !== undefined) {
      update.payment_frequency = normalizeOptionalString(patch.paymentFrequency);
    }
    if (patch.sumInsured !== undefined) update.sum_insured = normalizeOptionalNumber(patch.sumInsured);
    if (patch.deductible !== undefined) update.deductible = normalizeOptionalNumber(patch.deductible);
    if (isValidStoredStatus(patch.status)) update.status = patch.status;

    if (Object.keys(update).length > 0) {
      const { error: updateError } = await db
        .from('broker_policies')
        .update(update)
        .eq('broker_id', brokerId)
        .eq('id', policyId);
      if (updateError) {
        throw AppError.internal('Failed to update policy', { reason: updateError.message });
      }
    }

    return this.getPolicy(brokerId, policyId, now);
  }

  /** Fetch a single policy scoped to the broker, or 404. */
  async getPolicy(brokerId: string, policyId: string, now: Date = new Date()): Promise<PolicyView> {
    const { data, error } = await this.db()
      .from('broker_policies')
      .select(POLICY_SELECT)
      .eq('broker_id', brokerId)
      .eq('id', policyId)
      .maybeSingle();

    if (error) {
      throw AppError.internal('Failed to load policy', { reason: error.message });
    }
    if (!data) {
      throw AppError.notFound('Policy not found');
    }
    return this.mapPolicy(data as unknown as PolicyRow, now);
  }

  /**
   * Build the renewal calendar: renewals due within 90 days with dates +
   * amounts, each flagged `dueSoon` when within 30 days (R11.2/R11.3).
   */
  async getRenewalCalendar(brokerId: string, now: Date = new Date()): Promise<RenewalCalendar> {
    const rows = await this.fetchRenewalRows(brokerId);

    const entries: RenewalCalendarEntry[] = [];
    for (const row of rows) {
      const policy = row.broker_policies;
      if (!policy) continue;
      const classification = classifyRenewal(row.renewal_date, now);
      if (!classification.withinWindow) continue;

      entries.push({
        renewalId: row.id,
        policyId: policy.id,
        clientId: policy.client_id,
        clientName: policy.clients?.full_name ?? null,
        policyType: policy.policy_type,
        insurer: policy.insurer,
        renewalDate: row.renewal_date,
        premiumAmount: row.premium_amount === null ? null : toNumber(row.premium_amount),
        daysUntil: classification.daysUntil,
        dueSoon: classification.dueSoon,
      });
    }

    // Soonest renewals first.
    entries.sort((a, b) => (a.daysUntil ?? Infinity) - (b.daysUntil ?? Infinity));

    return {
      windowDays: 90,
      dueSoonDays: 30,
      entries,
    };
  }

  /**
   * Send renewal reminders to clients whose policies renew within the selected
   * window (R11.5). Marks delivered renewals `reminder_sent = true`, and returns
   * the confirmation count plus any failed recipients for retry (R11.7).
   */
  async sendRenewalReminders(
    brokerId: string,
    options: { withinDays?: unknown } = {},
    now: Date = new Date(),
  ): Promise<ReminderSummary> {
    const windowDays = normalizeReminderWindow(options.withinDays);
    const rows = await this.fetchRenewalRows(brokerId);

    const candidates: ReminderCandidate[] = rows
      .filter((row) => row.broker_policies)
      .map((row) => {
        const policy = row.broker_policies!;
        const contact = policy.clients?.email ?? policy.clients?.phone ?? null;
        return {
          renewalId: row.id,
          clientId: policy.client_id,
          clientName: policy.clients?.full_name ?? 'Unknown client',
          contact: normalizeOptionalString(contact),
          renewalDate: row.renewal_date,
        };
      });

    const plan = planRenewalReminders(candidates, windowDays, now);

    if (plan.sentRenewalIds.length > 0) {
      const { error } = await this.db()
        .from('renewals')
        .update({ reminder_sent: true })
        .in('id', plan.sentRenewalIds);
      if (error) {
        throw AppError.internal('Failed to record sent reminders', { reason: error.message });
      }
    }

    return { windowDays, sentCount: plan.sentCount, failed: plan.failed };
  }

  /**
   * Build the premium tracker: collection status (Paid/Pending/Overdue) plus a
   * trailing-12-month chart broken down by insurance type (R11.4).
   */
  async getPremiumTracker(brokerId: string, now: Date = new Date()): Promise<PremiumTracker> {
    const { data, error } = await this.db()
      .from('broker_policies')
      .select('policy_type, premium_amount, status, start_date, end_date')
      .eq('broker_id', brokerId);

    if (error) {
      throw AppError.internal('Failed to load premium data', { reason: error.message });
    }

    const rows = (data ?? []) as Array<{
      policy_type: string | null;
      premium_amount: number | string | null;
      status: string | null;
      start_date: string | null;
      end_date: string | null;
    }>;

    return computePremiumTracker(
      rows.map((r) => ({
        policyType: r.policy_type,
        premiumAmount: r.premium_amount,
        status: r.status,
        startDate: r.start_date,
        endDate: r.end_date,
      })),
      now,
    );
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Fetch the broker's scheduled renewals joined with policy + client. */
  private async fetchRenewalRows(brokerId: string): Promise<RenewalJoinRow[]> {
    const { data, error } = await this.db()
      .from('renewals')
      .select(RENEWAL_SELECT)
      .eq('broker_policies.broker_id', brokerId);

    if (error) {
      throw AppError.internal('Failed to load renewals', { reason: error.message });
    }
    return (data ?? []) as unknown as RenewalJoinRow[];
  }

  /** Ensure a client id belongs to this broker before linking a policy to it. */
  private async assertClientOwned(brokerId: string, clientId: string): Promise<void> {
    const { data, error } = await this.db()
      .from('clients')
      .select('id')
      .eq('broker_id', brokerId)
      .eq('id', clientId)
      .maybeSingle();

    if (error) {
      throw AppError.internal('Failed to verify client', { reason: error.message });
    }
    if (!data) {
      throw AppError.unprocessable('Policy validation failed', {
        missingFields: ['clientId'],
        endDateBeforeStart: false,
      });
    }
  }

  /** Map a nested policy row into the camel-cased view with derived status. */
  private mapPolicy(row: PolicyRow, now: Date): PolicyView {
    return {
      id: row.id,
      clientId: row.client_id,
      clientName: row.clients?.full_name ?? null,
      policyType: row.policy_type,
      insurer: row.insurer,
      startDate: row.start_date,
      endDate: row.end_date,
      premiumAmount: row.premium_amount === null ? null : toNumber(row.premium_amount),
      paymentFrequency: row.payment_frequency,
      sumInsured: row.sum_insured === null ? null : toNumber(row.sum_insured),
      deductible: row.deductible === null ? null : toNumber(row.deductible),
      status: derivePolicyStatus({ status: row.status, endDate: row.end_date }, now),
      storedStatus: row.status,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STORED_STATUSES = ['active', 'pending_renewal', 'expired', 'cancelled'] as const;

/** True when a value is a valid stored `broker_policy_status` enum value. */
function isValidStoredStatus(value: unknown): value is (typeof STORED_STATUSES)[number] {
  return typeof value === 'string' && (STORED_STATUSES as readonly string[]).includes(value);
}

/** Trim a value to a non-empty string, or `null`. */
function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Coerce a value to a finite number, or `null`. */
function normalizeOptionalNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
