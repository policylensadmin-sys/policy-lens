// FamilyService — CRUD + policy assignment for named household members (R6.6).
//
// Responsibilities (per design "Services" → Vault / family_members):
//   - List the family members belonging to an owner profile, so policies can be
//     organized and filtered by member (R6.3/R6.6).
//   - Create a new family member for an owner, validating that a name is
//     provided (surfaced to the caller as a 422 field-validation error).
//   - Assign an owned policy to one of the owner's family members (or clear the
//     assignment) by setting `policies.family_member_id` (R6.6).
//
// Every operation is scoped to the caller's `owner_id` (`profiles.id`) so a
// user can only read or mutate their own household and policies (R21.1). The
// service talks to Supabase through the service-role client (bypasses RLS) so
// it can act on the user's behalf; the client is resolved lazily so the module
// can be imported in mock/dev mode without Supabase credentials.

import type { SupabaseClient } from '@supabase/supabase-js';

import type { FamilyMember } from '@policylens/shared';

import { getSupabaseServiceRoleClient } from '../../lib/supabase';
import { AppError } from '../../middleware/errorHandler';

/** Shape of a `family_members` row as returned by Supabase (snake_case). */
interface FamilyMemberRow {
  id: string;
  owner_id: string;
  name: string;
  relation: string;
  created_at: string;
  updated_at: string;
}

/** Fields accepted when creating a family member. */
export interface CreateFamilyMemberInput {
  /** Display name of the household member (required, R6.6). */
  name: string;
  /** Relationship label (e.g. "spouse", "child"). Optional; defaults to "self". */
  relation?: string;
}

/** Default relation applied when the caller does not specify one. */
const DEFAULT_RELATION = 'self';

/** Map a `family_members` row to the shared {@link FamilyMember} view model. */
function toFamilyMember(row: FamilyMemberRow): FamilyMember {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    relation: row.relation,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Read and trim a required string field, returning `undefined` when empty. */
function requiredString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Manages a customer's named family members and their assignment to policies
 * (R6.6). All methods are owner-scoped by `profiles.id`.
 */
export class FamilyService {
  private client: SupabaseClient | undefined;

  constructor(client?: SupabaseClient) {
    this.client = client;
  }

  /** Resolve the Supabase service-role client lazily (cached after first use). */
  private db(): SupabaseClient {
    if (!this.client) {
      this.client = getSupabaseServiceRoleClient();
    }
    return this.client;
  }

  /**
   * List the family members belonging to `ownerId`, ordered by creation time
   * (oldest first) for a stable UI ordering (R6.6).
   */
  async list(ownerId: string): Promise<FamilyMember[]> {
    const { data, error } = await this.db()
      .from('family_members')
      .select('id, owner_id, name, relation, created_at, updated_at')
      .eq('owner_id', ownerId)
      .order('created_at', { ascending: true });

    if (error) {
      throw AppError.internal('Failed to list family members', { cause: error.message });
    }
    return ((data ?? []) as FamilyMemberRow[]).map(toFamilyMember);
  }

  /**
   * Create a family member owned by `ownerId`. The `name` is required and must
   * be non-empty after trimming; otherwise a `422` field-validation error is
   * raised (R6.6). `relation` defaults to `"self"` when omitted.
   */
  async create(ownerId: string, input: CreateFamilyMemberInput): Promise<FamilyMember> {
    const name = requiredString(input?.name);
    if (!name) {
      throw AppError.unprocessable('A family member name is required.', {
        field: 'name',
      });
    }
    const relation = requiredString(input?.relation) ?? DEFAULT_RELATION;

    const { data, error } = await this.db()
      .from('family_members')
      .insert({ owner_id: ownerId, name, relation })
      .select('id, owner_id, name, relation, created_at, updated_at')
      .single();

    if (error || !data) {
      throw AppError.internal('Failed to create family member', { cause: error?.message });
    }
    return toFamilyMember(data as FamilyMemberRow);
  }

  /**
   * Assign an owned policy to one of the owner's family members by setting
   * `policies.family_member_id` (R6.6). Passing `null` for `memberId` clears the
   * assignment. Verifies ownership of both the policy and (when set) the member
   * before writing, raising `404` when either is not found for this owner.
   */
  async assignPolicy(
    ownerId: string,
    policyId: string,
    memberId: string | null,
  ): Promise<FamilyMember | null> {
    // Verify the member belongs to the owner (when assigning, not clearing).
    let member: FamilyMember | null = null;
    if (memberId !== null) {
      const { data: memberRow, error: memberError } = await this.db()
        .from('family_members')
        .select('id, owner_id, name, relation, created_at, updated_at')
        .eq('id', memberId)
        .eq('owner_id', ownerId)
        .maybeSingle();

      if (memberError) {
        throw AppError.internal('Failed to load family member', {
          cause: memberError.message,
        });
      }
      if (!memberRow) {
        throw AppError.notFound('Family member not found');
      }
      member = toFamilyMember(memberRow as FamilyMemberRow);
    }

    // Update the policy only when it is owned by the caller; if no row matches
    // the (id, owner_id) pair the update affects nothing and we surface a 404.
    const { data: updated, error: updateError } = await this.db()
      .from('policies')
      .update({ family_member_id: memberId })
      .eq('id', policyId)
      .eq('owner_id', ownerId)
      .select('id')
      .maybeSingle();

    if (updateError) {
      throw AppError.internal('Failed to assign policy to family member', {
        cause: updateError.message,
      });
    }
    if (!updated) {
      throw AppError.notFound('Policy not found');
    }

    return member;
  }
}
