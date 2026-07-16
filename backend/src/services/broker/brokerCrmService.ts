// BrokerCrmService — leads, team, and documents management (R19.4/19.5/19.6).
//
// Owns the Supabase reads/writes behind the broker CRM surface that is not
// covered by the client/policy/claims services:
//
//   • Leads      — the sales pipeline the broker tracks (name, contact, stage,
//                  notes). List/create/update/delete, broker-scoped (R19.4).
//   • Team       — the broker's team members with role-based permissions stored
//                  as a jsonb map. List/add/remove plus assign/revoke of
//                  individual permission keys (R19.5).
//   • Documents  — files the broker stores, optionally categorized by client
//                  and/or policy. List/upload (multipart → Supabase Storage +
//                  metadata row)/delete (R19.6).
//
// Every operation is scoped to the caller's broker (resolved from their
// profile) so a broker only ever sees or mutates their own records, mirroring
// the RLS policy. The service resolves the service-role Supabase client lazily
// so the module imports cleanly in mock/dev mode without credentials.

import { extname } from 'node:path';
import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { getSupabaseServiceRoleClient } from '../../lib/supabase';
import { AppError } from '../../middleware/errorHandler';

/** Supabase Storage bucket holding broker documents (broker-namespaced). */
export const BROKER_DOCS_BUCKET = 'broker-docs';

// ---------------------------------------------------------------------------
// View + input types
// ---------------------------------------------------------------------------

/** A lead as returned in list/detail payloads. */
export interface LeadView {
  id: string;
  brokerId: string;
  name: string;
  contact: string | null;
  stage: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Body accepted when creating a lead (R19.4). */
export interface NewLeadInput {
  name?: unknown;
  contact?: unknown;
  stage?: unknown;
  notes?: unknown;
}

/** Body accepted when editing a lead (R19.4). */
export interface EditLeadInput {
  name?: unknown;
  contact?: unknown;
  stage?: unknown;
  notes?: unknown;
}

/** A team member as returned in list/detail payloads. */
export interface TeamMemberView {
  id: string;
  brokerId: string;
  name: string;
  role: string | null;
  permissions: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** Body accepted when adding a team member (R19.5). */
export interface NewTeamMemberInput {
  name?: unknown;
  role?: unknown;
  permissions?: unknown;
}

/**
 * Body accepted when assigning/revoking team member permissions (R19.5). Grants
 * are merged into the existing permission map; revokes remove keys. A full
 * `permissions` object replaces the map outright.
 */
export interface PermissionPatchInput {
  permissions?: unknown;
  grant?: unknown;
  revoke?: unknown;
}

/** A document as returned in list/detail payloads. */
export interface DocumentView {
  id: string;
  brokerId: string;
  clientId: string | null;
  brokerPolicyId: string | null;
  name: string;
  storagePath: string | null;
  category: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Filters accepted when listing documents (categorize by client/policy). */
export interface DocumentFilters {
  clientId?: string;
  brokerPolicyId?: string;
  category?: string;
}

/** Metadata + bytes accepted when uploading a document (R19.6). */
export interface UploadDocumentInput {
  /** Original filename supplied by the client (used for name + storage slug). */
  filename: string;
  /** Raw file bytes (from Multer memory storage). */
  file: Buffer;
  /** Declared/verified MIME type. */
  mimeType: string;
  /** Optional display name; defaults to the original filename. */
  name?: unknown;
  /** Optional category label. */
  category?: unknown;
  /** Optional client association. */
  clientId?: unknown;
  /** Optional policy association. */
  brokerPolicyId?: unknown;
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface LeadRow {
  id: string;
  broker_id: string;
  name: string;
  contact: string | null;
  stage: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface TeamMemberRow {
  id: string;
  broker_id: string;
  name: string;
  role: string | null;
  permissions: unknown;
  created_at: string;
  updated_at: string;
}

interface DocumentRow {
  id: string;
  broker_id: string;
  client_id: string | null;
  broker_policy_id: string | null;
  name: string;
  storage_path: string | null;
  category: string | null;
  created_at: string;
  updated_at: string;
}

const LEAD_SELECT = 'id, broker_id, name, contact, stage, notes, created_at, updated_at';
const TEAM_SELECT = 'id, broker_id, name, role, permissions, created_at, updated_at';
const DOCUMENT_SELECT =
  'id, broker_id, client_id, broker_policy_id, name, storage_path, category, created_at, updated_at';

/**
 * Owns broker leads / team / documents management (R19.4/19.5/19.6). Inject a
 * client for testing.
 */
export class BrokerCrmService {
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

  // -------------------------------------------------------------------------
  // Leads (R19.4)
  // -------------------------------------------------------------------------

  /** List a broker's leads, newest first (R19.4). */
  async listLeads(brokerId: string): Promise<LeadView[]> {
    const { data, error } = await this.db()
      .from('leads')
      .select(LEAD_SELECT)
      .eq('broker_id', brokerId)
      .order('created_at', { ascending: false });

    if (error) {
      throw AppError.internal('Failed to load leads', { reason: error.message });
    }
    return ((data ?? []) as unknown as LeadRow[]).map(mapLead);
  }

  /** Create a lead. A non-empty `name` is required (`422` otherwise) (R19.4). */
  async createLead(brokerId: string, body: NewLeadInput): Promise<LeadView> {
    const name = requiredString(body.name);
    if (!name) {
      throw AppError.unprocessable('Missing required fields', { missingFields: ['name'] });
    }

    const { data, error } = await this.db()
      .from('leads')
      .insert({
        broker_id: brokerId,
        name,
        contact: optionalString(body.contact),
        stage: optionalString(body.stage),
        notes: optionalString(body.notes),
      })
      .select(LEAD_SELECT)
      .single();

    if (error || !data) {
      throw AppError.internal('Failed to create lead', { reason: error?.message });
    }
    return mapLead(data as unknown as LeadRow);
  }

  /**
   * Edit a lead's fields (R19.4). Only provided fields are patched; clearing
   * `name` to an empty value returns `422`. Throws `404` if not found under this
   * broker.
   */
  async updateLead(brokerId: string, leadId: string, patch: EditLeadInput): Promise<LeadView> {
    await this.assertLeadExists(brokerId, leadId);

    const update: Record<string, unknown> = {};
    if (patch.name !== undefined) {
      const name = requiredString(patch.name);
      if (!name) {
        throw AppError.unprocessable('Missing required fields', { missingFields: ['name'] });
      }
      update.name = name;
    }
    if (patch.contact !== undefined) update.contact = optionalString(patch.contact);
    if (patch.stage !== undefined) update.stage = optionalString(patch.stage);
    if (patch.notes !== undefined) update.notes = optionalString(patch.notes);

    if (Object.keys(update).length > 0) {
      const { error } = await this.db()
        .from('leads')
        .update(update)
        .eq('broker_id', brokerId)
        .eq('id', leadId);
      if (error) {
        throw AppError.internal('Failed to update lead', { reason: error.message });
      }
    }

    return this.getLead(brokerId, leadId);
  }

  /** Delete a lead (R19.4). Throws `404` if not found under this broker. */
  async deleteLead(brokerId: string, leadId: string): Promise<void> {
    await this.assertLeadExists(brokerId, leadId);
    const { error } = await this.db()
      .from('leads')
      .delete()
      .eq('broker_id', brokerId)
      .eq('id', leadId);
    if (error) {
      throw AppError.internal('Failed to delete lead', { reason: error.message });
    }
  }

  private async getLead(brokerId: string, leadId: string): Promise<LeadView> {
    const { data, error } = await this.db()
      .from('leads')
      .select(LEAD_SELECT)
      .eq('broker_id', brokerId)
      .eq('id', leadId)
      .maybeSingle();
    if (error) {
      throw AppError.internal('Failed to load lead', { reason: error.message });
    }
    if (!data) {
      throw AppError.notFound('Lead not found');
    }
    return mapLead(data as unknown as LeadRow);
  }

  private async assertLeadExists(brokerId: string, leadId: string): Promise<void> {
    const { data, error } = await this.db()
      .from('leads')
      .select('id')
      .eq('broker_id', brokerId)
      .eq('id', leadId)
      .maybeSingle();
    if (error) {
      throw AppError.internal('Failed to load lead', { reason: error.message });
    }
    if (!data) {
      throw AppError.notFound('Lead not found');
    }
  }

  // -------------------------------------------------------------------------
  // Team (R19.5)
  // -------------------------------------------------------------------------

  /** List a broker's team members, newest first (R19.5). */
  async listTeam(brokerId: string): Promise<TeamMemberView[]> {
    const { data, error } = await this.db()
      .from('team_members')
      .select(TEAM_SELECT)
      .eq('broker_id', brokerId)
      .order('created_at', { ascending: false });

    if (error) {
      throw AppError.internal('Failed to load team members', { reason: error.message });
    }
    return ((data ?? []) as unknown as TeamMemberRow[]).map(mapTeamMember);
  }

  /**
   * Add a team member with optional role and initial permissions map (R19.5). A
   * non-empty `name` is required (`422` otherwise).
   */
  async addTeamMember(brokerId: string, body: NewTeamMemberInput): Promise<TeamMemberView> {
    const name = requiredString(body.name);
    if (!name) {
      throw AppError.unprocessable('Missing required fields', { missingFields: ['name'] });
    }

    const { data, error } = await this.db()
      .from('team_members')
      .insert({
        broker_id: brokerId,
        name,
        role: optionalString(body.role),
        permissions: toPermissionsMap(body.permissions),
      })
      .select(TEAM_SELECT)
      .single();

    if (error || !data) {
      throw AppError.internal('Failed to add team member', { reason: error?.message });
    }
    return mapTeamMember(data as unknown as TeamMemberRow);
  }

  /**
   * Assign or revoke a team member's role-based permissions (R19.5). A full
   * `permissions` object replaces the map; otherwise `grant` keys are merged in
   * (as `true`) and `revoke` keys are removed. Throws `404` if not found under
   * this broker.
   */
  async updateTeamPermissions(
    brokerId: string,
    memberId: string,
    patch: PermissionPatchInput,
  ): Promise<TeamMemberView> {
    const existing = await this.getTeamMember(brokerId, memberId);

    let nextPermissions: Record<string, unknown>;
    if (patch.permissions !== undefined) {
      nextPermissions = toPermissionsMap(patch.permissions);
    } else {
      nextPermissions = { ...existing.permissions };
      for (const key of toKeyList(patch.grant)) {
        nextPermissions[key] = true;
      }
      for (const key of toKeyList(patch.revoke)) {
        delete nextPermissions[key];
      }
    }

    const { error } = await this.db()
      .from('team_members')
      .update({ permissions: nextPermissions })
      .eq('broker_id', brokerId)
      .eq('id', memberId);
    if (error) {
      throw AppError.internal('Failed to update team member permissions', {
        reason: error.message,
      });
    }

    return this.getTeamMember(brokerId, memberId);
  }

  /** Remove a team member (R19.5). Throws `404` if not found under this broker. */
  async removeTeamMember(brokerId: string, memberId: string): Promise<void> {
    await this.getTeamMember(brokerId, memberId);
    const { error } = await this.db()
      .from('team_members')
      .delete()
      .eq('broker_id', brokerId)
      .eq('id', memberId);
    if (error) {
      throw AppError.internal('Failed to remove team member', { reason: error.message });
    }
  }

  private async getTeamMember(brokerId: string, memberId: string): Promise<TeamMemberView> {
    const { data, error } = await this.db()
      .from('team_members')
      .select(TEAM_SELECT)
      .eq('broker_id', brokerId)
      .eq('id', memberId)
      .maybeSingle();
    if (error) {
      throw AppError.internal('Failed to load team member', { reason: error.message });
    }
    if (!data) {
      throw AppError.notFound('Team member not found');
    }
    return mapTeamMember(data as unknown as TeamMemberRow);
  }

  // -------------------------------------------------------------------------
  // Documents (R19.6)
  // -------------------------------------------------------------------------

  /**
   * List a broker's documents, optionally filtered by client, policy, or
   * category (R19.6). Newest first.
   */
  async listDocuments(brokerId: string, filters: DocumentFilters = {}): Promise<DocumentView[]> {
    let query = this.db()
      .from('documents')
      .select(DOCUMENT_SELECT)
      .eq('broker_id', brokerId);

    if (filters.clientId) query = query.eq('client_id', filters.clientId);
    if (filters.brokerPolicyId) query = query.eq('broker_policy_id', filters.brokerPolicyId);
    if (filters.category) query = query.eq('category', filters.category);

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) {
      throw AppError.internal('Failed to load documents', { reason: error.message });
    }
    return ((data ?? []) as unknown as DocumentRow[]).map(mapDocument);
  }

  /**
   * Upload a document: persist the file to the broker-namespaced Storage bucket
   * and insert the metadata row, categorized by client/policy (R19.6). The
   * just-uploaded object is cleaned up if the metadata write fails so we never
   * orphan storage objects.
   */
  async uploadDocument(brokerId: string, input: UploadDocumentInput): Promise<DocumentView> {
    const db = this.db();
    const displayName = requiredString(input.name) ?? input.filename.trim() ?? 'Document';
    const storagePath = buildStoragePath(brokerId, input.filename);

    // 1) Persist the original file to broker-namespaced storage.
    const { error: uploadError } = await db.storage
      .from(BROKER_DOCS_BUCKET)
      .upload(storagePath, input.file, { contentType: input.mimeType, upsert: false });
    if (uploadError) {
      throw AppError.internal('Failed to store document', { reason: uploadError.message });
    }

    // 2) Insert the metadata row.
    const { data, error } = await db
      .from('documents')
      .insert({
        broker_id: brokerId,
        client_id: optionalString(input.clientId),
        broker_policy_id: optionalString(input.brokerPolicyId),
        name: displayName,
        storage_path: storagePath,
        category: optionalString(input.category),
      })
      .select(DOCUMENT_SELECT)
      .single();

    if (error || !data) {
      // Best-effort cleanup of the just-uploaded object to avoid orphans.
      await this.removeStoredObject(storagePath);
      throw AppError.internal('Failed to create document record', { reason: error?.message });
    }

    return mapDocument(data as unknown as DocumentRow);
  }

  /**
   * Delete a document (R19.6). Removes the stored object first (best-effort),
   * then the metadata row. Throws `404` if not found under this broker.
   */
  async deleteDocument(brokerId: string, documentId: string): Promise<void> {
    const db = this.db();
    const { data, error } = await db
      .from('documents')
      .select('id, storage_path')
      .eq('broker_id', brokerId)
      .eq('id', documentId)
      .maybeSingle();
    if (error) {
      throw AppError.internal('Failed to load document', { reason: error.message });
    }
    if (!data) {
      throw AppError.notFound('Document not found');
    }

    const storagePath = (data as { storage_path: string | null }).storage_path;
    if (storagePath) {
      await this.removeStoredObject(storagePath);
    }

    const { error: deleteError } = await db
      .from('documents')
      .delete()
      .eq('broker_id', brokerId)
      .eq('id', documentId);
    if (deleteError) {
      throw AppError.internal('Failed to delete document', { reason: deleteError.message });
    }
  }

  /** Best-effort removal of a stored object; swallows errors (cleanup path). */
  private async removeStoredObject(storagePath: string): Promise<void> {
    try {
      await this.db().storage.from(BROKER_DOCS_BUCKET).remove([storagePath]);
    } catch {
      // Cleanup is best-effort; the primary error is surfaced by the caller.
    }
  }
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapLead(row: LeadRow): LeadView {
  return {
    id: row.id,
    brokerId: row.broker_id,
    name: row.name,
    contact: row.contact,
    stage: row.stage,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTeamMember(row: TeamMemberRow): TeamMemberView {
  return {
    id: row.id,
    brokerId: row.broker_id,
    name: row.name,
    role: row.role,
    permissions: toPermissionsMap(row.permissions),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDocument(row: DocumentRow): DocumentView {
  return {
    id: row.id,
    brokerId: row.broker_id,
    clientId: row.client_id,
    brokerPolicyId: row.broker_policy_id,
    name: row.name,
    storagePath: row.storage_path,
    category: row.category,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Trim a value to a non-empty string, or `undefined` (treated as required). */
function requiredString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Trim a value to a non-empty string, or `null` (optional field). */
function optionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Coerce an unknown value into a plain permissions object. */
function toPermissionsMap(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

/** Coerce an unknown value into a list of non-empty string keys. */
function toKeyList(value: unknown): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  }
  if (Array.isArray(value)) {
    return value
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
  }
  return [];
}

/**
 * Build the broker-namespaced storage path: `{brokerId}/{uuid}-{filename}`.
 * The filename is sanitized to a safe slug (keeping the extension) so arbitrary
 * client-supplied names cannot alter the path structure.
 */
function buildStoragePath(brokerId: string, originalFilename: string): string {
  const ext = extname(originalFilename).toLowerCase();
  const base = originalFilename.slice(0, originalFilename.length - ext.length);
  const safeBase = slugify(base) || 'document';
  const safeExt = /^\.[a-z0-9]+$/.test(ext) ? ext : '';
  return `${brokerId}/${randomUUID()}-${safeBase}${safeExt}`;
}

/** Lowercase, replace non-alphanumeric runs with `-`, trim, and cap length. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}
