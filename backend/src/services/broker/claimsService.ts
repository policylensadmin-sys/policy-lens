// ClaimsService — broker claims tracking, Claim Assistant, and commission (R9.3, R12).
//
// Owns the Supabase reads/writes behind the `/api/broker/claims` and
// `/api/broker/commission` surfaces and composes the pure rules in
// `claimsLogic` for pagination, filtering, and Claim Assistant validation. The
// commission overview reuses the shared aggregation used by the dashboard so
// both surfaces report identical totals (R9.3).
//
// Claims have no `broker_id` column of their own, so all access is scoped to
// the caller's broker by joining `broker_policies` (mirroring the RLS policy):
// a broker only ever sees or mutates claims filed against their own policies.
//
// Endpoints served (via brokerClaimsController):
//   • GET  /broker/claims           — paginated list (≤50/page) w/ filters (R12.1/R12.3)
//   • POST /broker/claims           — Claim Assistant submit (validation → 422, R12.4/R12.5)
//   • PUT  /broker/claims/:id/status — update status + notify broker (R12.2)
//   • GET  /broker/commission       — commission overview (R9.3)
//
// The service resolves the service-role client lazily so the module imports
// cleanly in mock/dev mode without Supabase credentials.

import type { SupabaseClient } from '@supabase/supabase-js';

import type { ClaimStatus } from '@policylens/shared';

import { getSupabaseServiceRoleClient } from '../../lib/supabase';
import { AppError } from '../../middleware/errorHandler';
import {
  computeCommissionOverview,
  type CommissionOverview,
} from './brokerDashboardService';
import {
  claimPageBounds,
  claimTotalPages,
  validateClaimSubmission,
  type ClaimFilters,
  type ClaimSubmissionInput,
} from './claimsLogic';

/** Notification `type` emitted when a claim's status changes (R12.2). */
export const CLAIM_STATUS_CHANGED_NOTIFICATION_TYPE = 'claim_status_changed';

/** Fallback currency when the broker has none configured (mirrors dashboard). */
const DEFAULT_CURRENCY = 'INR';

/** A claim as returned in list/detail payloads (camel-cased). */
export interface ClaimView {
  id: string;
  clientId: string;
  clientName: string | null;
  policyId: string;
  /** Policy reference shown as the "policy number" in the claims table (R12.1). */
  policyNumber: string;
  policyType: string | null;
  insurer: string | null;
  claimType: string;
  claimedAmount: number | null;
  status: ClaimStatus;
  /** Claim submission date (R12.1). */
  submittedAt: string | null;
}

/** A paginated list of claims (≤50 per page, R12.1). */
export interface ClaimPage {
  claims: ClaimView[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

/** Raw nested claim row returned by Supabase (with its client + policy). */
interface ClaimRow {
  id: string;
  client_id: string;
  claim_type: string;
  claimed_amount: number | string | null;
  status: string;
  submitted_at: string | null;
  clients?: { full_name: string | null } | null;
  broker_policies?: {
    id: string;
    broker_id: string;
    policy_type: string | null;
    insurer: string | null;
    client_id: string;
  } | null;
}

interface CommissionRow {
  amount: number | string | null;
  status: string | null;
  scheduled_date: string | null;
  paid_date: string | null;
}

const CLAIM_SELECT =
  'id, client_id, claim_type, claimed_amount, status, submitted_at, ' +
  'clients (full_name), ' +
  'broker_policies!inner (id, broker_id, policy_type, insurer, client_id)';

/** Owns broker claims management + commission overview (R9.3, R12). */
export class ClaimsService {
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
   * List a broker's claims, paginated at ≤50 per page (R12.1), with optional
   * filtering by status, client, policy type, and submission date range
   * (R12.3). Claims are scoped to the broker by joining `broker_policies`.
   * Ordered by submission date (newest first). An empty list is returned when
   * no claims match — the controller surfaces the "no results" message (R12.3).
   */
  async listClaims(brokerId: string, filters: ClaimFilters & { page?: unknown } = {}): Promise<ClaimPage> {
    const bounds = claimPageBounds(filters.page);

    let query = this.db()
      .from('claims')
      .select(CLAIM_SELECT, { count: 'exact' })
      .eq('broker_policies.broker_id', brokerId);

    if (filters.status) query = query.eq('status', filters.status);
    if (filters.clientId) query = query.eq('client_id', filters.clientId);
    if (filters.policyType && filters.policyType.trim().length > 0) {
      query = query.eq('broker_policies.policy_type', filters.policyType.trim());
    }
    if (filters.from) query = query.gte('submitted_at', filters.from);
    if (filters.to) query = query.lte('submitted_at', filters.to);

    const { data, error, count } = await query
      .order('submitted_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: true })
      .range(bounds.from, bounds.to);

    if (error) {
      throw AppError.internal('Failed to load claims', { reason: error.message });
    }

    const rows = (data ?? []) as unknown as ClaimRow[];
    const totalCount = count ?? rows.length;

    return {
      claims: rows.map((row) => mapClaim(row)),
      page: bounds.page,
      pageSize: bounds.pageSize,
      totalCount,
      totalPages: claimTotalPages(totalCount, bounds.pageSize),
    };
  }

  /**
   * Fetch a single claim scoped to the broker, or 404.
   */
  async getClaim(brokerId: string, claimId: string): Promise<ClaimView> {
    const { data, error } = await this.db()
      .from('claims')
      .select(CLAIM_SELECT)
      .eq('broker_policies.broker_id', brokerId)
      .eq('id', claimId)
      .maybeSingle();

    if (error) {
      throw AppError.internal('Failed to load claim', { reason: error.message });
    }
    if (!data) {
      throw AppError.notFound('Claim not found');
    }
    return mapClaim(data as unknown as ClaimRow);
  }

  /**
   * Commission overview for the broker: total / paid / pending / overdue
   * amounts, each rounded to 2 decimals in the broker's configured currency
   * (R9.3). "Overdue" is any unpaid commission more than 30 days past its
   * scheduled payment date. Uses the same aggregation as the dashboard so both
   * surfaces report identical totals. Returns zero amounts when the broker has
   * no commissions.
   */
  async getCommissionOverview(brokerId: string, now: Date = new Date()): Promise<CommissionOverview> {
    const db = this.db();

    const { data: broker, error: brokerError } = await db
      .from('brokers')
      .select('currency')
      .eq('id', brokerId)
      .maybeSingle();
    if (brokerError) {
      throw AppError.internal('Failed to load broker account', { reason: brokerError.message });
    }
    const currency = ((broker?.currency as string | null) ?? '').trim() || DEFAULT_CURRENCY;

    const policyIds = await this.fetchPolicyIds(brokerId);
    if (policyIds.length === 0) {
      return computeCommissionOverview([], currency, now);
    }

    const { data, error } = await db
      .from('commissions')
      .select('amount, status, scheduled_date, paid_date')
      .in('broker_policy_id', policyIds);

    if (error) {
      throw AppError.internal('Failed to load commissions', { reason: error.message });
    }

    return computeCommissionOverview((data as CommissionRow[] | null) ?? [], currency, now);
  }

  /**
   * Update a claim's status and record an in-app notification to the broker
   * indicating the client name, claim reference, and new status (R12.2). The
   * claim must belong to this broker (404 otherwise). Returns the updated claim.
   */
  async updateClaimStatus(brokerId: string, claimId: string, status: ClaimStatus): Promise<ClaimView> {
    const db = this.db();

    // Ensure the claim belongs to this broker before mutating it.
    const existing = await this.getClaim(brokerId, claimId);

    const { error: updateError } = await db
      .from('claims')
      .update({ status })
      .eq('id', claimId);
    if (updateError) {
      throw AppError.internal('Failed to update claim status', { reason: updateError.message });
    }

    await this.notifyBrokerOfStatusChange(brokerId, existing, status);

    return this.getClaim(brokerId, claimId);
  }

  /**
   * Submit a claim on behalf of a client via the Claim Assistant (R12.4).
   * Validates the required information first — policy selection, incident date,
   * incident description, and supporting documents — raising `422` naming the
   * missing fields to prevent submission (R12.5). The selected policy must
   * belong to this broker. The new claim starts in `pending` status.
   */
  async submitClaimViaAssistant(brokerId: string, body: ClaimSubmissionInput): Promise<ClaimView> {
    const validation = validateClaimSubmission(body);
    if (!validation.valid) {
      throw AppError.unprocessable('Missing required claim information', {
        missingFields: validation.missingFields,
      });
    }

    const db = this.db();
    const policyId = (body.policyId as string).trim();

    // The policy must belong to this broker; also gives us the client id.
    const { data: policy, error: policyError } = await db
      .from('broker_policies')
      .select('id, client_id')
      .eq('broker_id', brokerId)
      .eq('id', policyId)
      .maybeSingle();
    if (policyError) {
      throw AppError.internal('Failed to verify policy', { reason: policyError.message });
    }
    if (!policy?.id) {
      throw AppError.unprocessable('Missing required claim information', {
        missingFields: ['policyId'],
      });
    }

    const { data: created, error: insertError } = await db
      .from('claims')
      .insert({
        broker_policy_id: policyId,
        client_id: policy.client_id as string,
        claim_type: normalizeClaimType(body.claimType),
        claimed_amount: normalizeOptionalNumber(body.claimedAmount),
        status: 'pending',
        submitted_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (insertError || !created?.id) {
      throw AppError.internal('Failed to submit claim', { reason: insertError?.message });
    }

    return this.getClaim(brokerId, created.id as string);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Fetch the ids of every policy owned by the broker (for child scoping). */
  private async fetchPolicyIds(brokerId: string): Promise<string[]> {
    const { data, error } = await this.db()
      .from('broker_policies')
      .select('id')
      .eq('broker_id', brokerId);

    if (error) {
      throw AppError.internal('Failed to load broker policies', { reason: error.message });
    }
    return ((data as { id: string }[] | null) ?? []).map((row) => row.id);
  }

  /**
   * Insert an in-app notification to the broker's profile summarizing the claim
   * status change (R12.2). Best-effort: a notification failure surfaces as an
   * error so the caller can react, but the status update itself has committed.
   */
  private async notifyBrokerOfStatusChange(
    brokerId: string,
    claim: ClaimView,
    newStatus: ClaimStatus,
  ): Promise<void> {
    const db = this.db();

    const { data: broker, error: brokerError } = await db
      .from('brokers')
      .select('profile_id')
      .eq('id', brokerId)
      .maybeSingle();
    if (brokerError || !broker?.profile_id) {
      throw AppError.internal('Failed to resolve broker profile for notification', {
        reason: brokerError?.message,
      });
    }

    const { error } = await db.from('notifications').insert({
      user_id: broker.profile_id as string,
      type: CLAIM_STATUS_CHANGED_NOTIFICATION_TYPE,
      payload: {
        claimId: claim.id,
        claimReference: claim.id,
        clientName: claim.clientName,
        policyId: claim.policyId,
        newStatus,
      },
    });
    if (error) {
      throw AppError.internal('Failed to record claim status notification', {
        reason: error.message,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map a nested claim row into the camel-cased view. */
function mapClaim(row: ClaimRow): ClaimView {
  const policy = row.broker_policies ?? null;
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.clients?.full_name ?? null,
    policyId: policy?.id ?? '',
    policyNumber: policy?.id ?? '',
    policyType: policy?.policy_type ?? null,
    insurer: policy?.insurer ?? null,
    claimType: row.claim_type,
    claimedAmount: row.claimed_amount === null ? null : toNumber(row.claimed_amount),
    status: row.status as ClaimStatus,
    submittedAt: row.submitted_at,
  };
}

/** Coerce a numeric/string/null DB value to a finite number, or `null`. */
function toNumber(value: number | string): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Trim a claim type to a non-empty string, defaulting to `general`. */
function normalizeClaimType(value: unknown): string {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return 'general';
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
