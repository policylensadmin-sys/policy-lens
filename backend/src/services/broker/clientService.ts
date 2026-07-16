// ClientService — broker client CRUD, profile, and risk dashboard (R10).
//
// Owns the Supabase reads/writes behind the `/api/broker/clients` surface and
// composes the pure rules in `clientLogic` for validation, filtering, risk
// categorization, and coverage-gap derivation. All access is scoped to the
// caller's broker (resolved from their profile) so a broker only ever sees or
// mutates their own clients (broker_id scoping mirrors the RLS policy).
//
// Endpoints served (via brokerController):
//   • GET    /broker/clients        — search/filter list (R10.1/R10.4)
//   • GET    /broker/clients/risk   — Risk Dashboard counts (R10.3)
//   • POST   /broker/clients        — add client + associated policies (R10.1/R10.5)
//   • GET    /broker/clients/:id    — client profile w/ policies + gaps (R10.2)
//   • PUT    /broker/clients/:id    — edit client core fields (R10.1/R10.5)
//
// The service resolves the service-role client lazily so the module imports
// cleanly in mock/dev mode without Supabase credentials.

import type { SupabaseClient } from '@supabase/supabase-js';

import { getSupabaseServiceRoleClient } from '../../lib/supabase';
import { AppError } from '../../middleware/errorHandler';
import {
  clientMatchesFilters,
  countRisk,
  deriveClientRisk,
  deriveCoverageGaps,
  toRiskFlags,
  validateClientEdit,
  validateNewClient,
  type ClientFilters,
  type ClientRiskInput,
  type CoverageGap,
  type EditClientInput,
  type NewClientInput,
  type NewClientPolicyInput,
  type RiskCounts,
} from './clientLogic';

// The nested select pulls each client with its associated broker policies (and
// each policy's scheduled renewals) in a single round-trip.
const CLIENT_SELECT =
  'id, broker_id, full_name, email, phone, risk_flags, created_at, updated_at, ' +
  'broker_policies (id, policy_type, insurer, start_date, end_date, premium_amount, ' +
  'payment_frequency, status, sum_insured, deductible, renewals (id, renewal_date, ' +
  'premium_amount, reminder_sent))';

/** A policy row as returned in a client profile/list payload (camel-cased). */
export interface ClientPolicyView {
  id: string;
  policyType: string;
  insurer: string | null;
  startDate: string | null;
  endDate: string | null;
  premiumAmount: number | null;
  paymentFrequency: string | null;
  status: string;
  sumInsured: number | null;
  deductible: number | null;
}

/** A client as returned in list/profile payloads. */
export interface ClientView {
  id: string;
  brokerId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  riskFlags: string[];
  policies: ClientPolicyView[];
  coverageGaps: CoverageGap[];
  risk: ReturnType<typeof deriveClientRisk>;
  createdAt: string;
  updatedAt: string;
}

/** Raw nested row returned by Supabase for a client + policies. */
interface ClientRow {
  id: string;
  broker_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  risk_flags: unknown;
  created_at: string;
  updated_at: string;
  broker_policies?: BrokerPolicyRow[] | null;
}

interface BrokerPolicyRow {
  id: string;
  policy_type: string;
  insurer: string | null;
  start_date: string | null;
  end_date: string | null;
  premium_amount: number | null;
  payment_frequency: string | null;
  status: string;
  sum_insured: number | null;
  deductible: number | null;
  renewals?: RenewalRow[] | null;
}

interface RenewalRow {
  id: string;
  renewal_date: string | null;
  premium_amount: number | null;
  reminder_sent: boolean;
}

/** Owns broker client management (R10). Inject a client for testing. */
export class ClientService {
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
   * List a broker's clients, applying name / policy-type / risk / renewal
   * filters in memory over a single joined fetch (R10.1/R10.4). Ordered by name.
   */
  async listClients(brokerId: string, filters: ClientFilters): Promise<ClientView[]> {
    const { data, error } = await this.db()
      .from('clients')
      .select(CLIENT_SELECT)
      .eq('broker_id', brokerId)
      .order('full_name', { ascending: true });

    if (error) {
      throw AppError.internal('Failed to load clients', { reason: error.message });
    }

    const rows = (data ?? []) as unknown as ClientRow[];
    const now = new Date();
    return rows
      .map((row) => this.mapClient(row))
      .filter((view) =>
        clientMatchesFilters(
          { fullName: view.fullName, riskFlags: view.riskFlags, policies: toRiskPolicies(view) },
          filters,
          now,
        ),
      );
  }

  /** Compute the Client Risk Dashboard counts for a broker (R10.3). */
  async getRiskDashboard(brokerId: string): Promise<RiskCounts> {
    const { data, error } = await this.db()
      .from('clients')
      .select(CLIENT_SELECT)
      .eq('broker_id', brokerId);

    if (error) {
      throw AppError.internal('Failed to load client risk data', { reason: error.message });
    }

    const rows = (data ?? []) as unknown as ClientRow[];
    const riskInputs: ClientRiskInput[] = rows.map((row) => {
      const view = this.mapClient(row);
      return { riskFlags: view.riskFlags, policies: toRiskPolicies(view) };
    });
    return countRisk(riskInputs);
  }

  /**
   * Fetch a single client's profile: details, associated policies, and derived
   * coverage gaps (R10.2). Throws `404` if not found under this broker.
   */
  async getClientProfile(brokerId: string, clientId: string): Promise<ClientView> {
    const { data, error } = await this.db()
      .from('clients')
      .select(CLIENT_SELECT)
      .eq('broker_id', brokerId)
      .eq('id', clientId)
      .maybeSingle();

    if (error) {
      throw AppError.internal('Failed to load client', { reason: error.message });
    }
    if (!data) {
      throw AppError.notFound('Client not found');
    }
    return this.mapClient(data as unknown as ClientRow);
  }

  /**
   * Create a client with at least one associated policy (R10.1). Validates
   * required fields first, raising `422` naming the missing fields (R10.5).
   */
  async createClient(brokerId: string, body: NewClientInput): Promise<ClientView> {
    const validation = validateNewClient(body);
    if (!validation.valid) {
      throw AppError.unprocessable('Missing required fields', {
        missingFields: validation.missingFields,
      });
    }

    const db = this.db();
    const riskFlags = toRiskFlags(body.riskFlags);

    const { data: clientRow, error: clientError } = await db
      .from('clients')
      .insert({
        broker_id: brokerId,
        full_name: (body.fullName as string).trim(),
        email: (body.email as string).trim(),
        phone: (body.phone as string).trim(),
        risk_flags: riskFlags,
      })
      .select('id')
      .single();

    if (clientError || !clientRow?.id) {
      throw AppError.internal('Failed to create client', { reason: clientError?.message });
    }

    const clientId = clientRow.id as string;
    const policyRows = (body.policies as NewClientPolicyInput[]).map((p) => ({
      broker_id: brokerId,
      client_id: clientId,
      policy_type: (p.policyType as string).trim(),
      insurer: normalizeOptionalString(p.insurer),
      start_date: normalizeOptionalString(p.startDate),
      end_date: normalizeOptionalString(p.endDate),
      premium_amount: normalizeOptionalNumber(p.premiumAmount),
      payment_frequency: normalizeOptionalString(p.paymentFrequency),
      sum_insured: normalizeOptionalNumber(p.sumInsured),
      deductible: normalizeOptionalNumber(p.deductible),
    }));

    const { error: policyError } = await db.from('broker_policies').insert(policyRows);
    if (policyError) {
      // Roll back the client so we never persist a client without its required
      // associated policy (R10.1).
      await db.from('clients').delete().eq('id', clientId);
      throw AppError.internal('Failed to create associated policies', {
        reason: policyError.message,
      });
    }

    return this.getClientProfile(brokerId, clientId);
  }

  /**
   * Edit a client's core fields (R10.1). Fetches the current record, validates
   * the merged result still satisfies the required fields (`422` otherwise,
   * R10.5), then applies the patch.
   */
  async updateClient(
    brokerId: string,
    clientId: string,
    patch: EditClientInput,
  ): Promise<ClientView> {
    const db = this.db();

    const { data: existing, error: existingError } = await db
      .from('clients')
      .select('id, full_name, email, phone')
      .eq('broker_id', brokerId)
      .eq('id', clientId)
      .maybeSingle();

    if (existingError) {
      throw AppError.internal('Failed to load client', { reason: existingError.message });
    }
    if (!existing) {
      throw AppError.notFound('Client not found');
    }

    const validation = validateClientEdit(
      {
        fullName: existing.full_name as string,
        email: (existing.email as string | null) ?? null,
        phone: (existing.phone as string | null) ?? null,
      },
      patch,
    );
    if (!validation.valid) {
      throw AppError.unprocessable('Missing required fields', {
        missingFields: validation.missingFields,
      });
    }

    const update: Record<string, unknown> = {};
    if (patch.fullName !== undefined) update.full_name = (patch.fullName as string).trim();
    if (patch.email !== undefined) update.email = (patch.email as string).trim();
    if (patch.phone !== undefined) update.phone = (patch.phone as string).trim();
    if (patch.riskFlags !== undefined) update.risk_flags = toRiskFlags(patch.riskFlags);

    if (Object.keys(update).length > 0) {
      const { error: updateError } = await db
        .from('clients')
        .update(update)
        .eq('broker_id', brokerId)
        .eq('id', clientId);
      if (updateError) {
        throw AppError.internal('Failed to update client', { reason: updateError.message });
      }
    }

    return this.getClientProfile(brokerId, clientId);
  }

  /** Map a nested client row into the camel-cased view with derived risk/gaps. */
  private mapClient(row: ClientRow): ClientView {
    const riskFlags = toRiskFlags(row.risk_flags);
    const policies: ClientPolicyView[] = (row.broker_policies ?? []).map((p) => ({
      id: p.id,
      policyType: p.policy_type,
      insurer: p.insurer,
      startDate: p.start_date,
      endDate: p.end_date,
      premiumAmount: p.premium_amount,
      paymentFrequency: p.payment_frequency,
      status: p.status,
      sumInsured: p.sum_insured,
      deductible: p.deductible,
    }));

    const riskInput: ClientRiskInput = {
      riskFlags,
      policies: policies.map((p) => ({
        policyType: p.policyType,
        deductible: p.deductible,
        endDate: p.endDate,
        renewalDate: firstRenewalDate(row.broker_policies ?? [], p.id),
      })),
    };

    return {
      id: row.id,
      brokerId: row.broker_id,
      fullName: row.full_name,
      email: row.email,
      phone: row.phone,
      riskFlags,
      policies,
      coverageGaps: deriveCoverageGaps(riskInput),
      risk: deriveClientRisk(riskInput),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build the risk-input policy list (with renewal dates) from a client view. */
function toRiskPolicies(view: ClientView): ClientRiskInput['policies'] {
  return view.policies.map((p) => ({
    policyType: p.policyType,
    deductible: p.deductible,
    endDate: p.endDate,
  }));
}

/** Pick the earliest upcoming renewal date for a policy id, if any. */
function firstRenewalDate(policies: BrokerPolicyRow[], policyId: string): string | null {
  const policy = policies.find((p) => p.id === policyId);
  const dates = (policy?.renewals ?? [])
    .map((r) => r.renewal_date)
    .filter((d): d is string => typeof d === 'string');
  if (dates.length === 0) return null;
  return dates.sort()[0] ?? null;
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
