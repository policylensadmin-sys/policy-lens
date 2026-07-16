// Broker CRM controller — HTTP layer for leads, team, and documents (R19).
//
// Thin request/response handlers that resolve the caller's broker id, parse and
// shape query/body/file input, delegate to {@link BrokerCrmService}, and return
// JSON. Validation, permission merging, and Storage persistence live in the
// service layer; errors forward to the central error handler as `AppError`s
// (422 for missing required fields, 404 for unknown records, etc.).
//
// The routes are guarded by `authMiddleware` + `rbacMiddleware('broker')`, so
// by the time these handlers run `req.user` is an authenticated broker. The
// document upload route additionally runs the `uploadSingle` chain, so
// `req.file` is a validated PDF/JPEG/PNG buffer.

import type { RequestHandler } from 'express';

import { AppError } from '../middleware/errorHandler';
import { BrokerCrmService, type DocumentFilters } from '../services/broker/brokerCrmService';

/** Shared service instance (lazily resolves its Supabase client on first use). */
const crmService = new BrokerCrmService();

/** Read a single string query param (Express may surface arrays). */
function queryString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].trim().length > 0) {
    return value[0].trim();
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Leads (R19.4)
// ---------------------------------------------------------------------------

/** `GET /api/broker/leads` — list the broker's leads (R19.4). */
export const listLeads: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  void (async () => {
    const brokerId = await crmService.resolveBrokerId(user.id);
    const leads = await crmService.listLeads(brokerId);
    res.json({ leads });
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to list leads'));
  });
};

/** `POST /api/broker/leads` — add a lead; missing `name` returns `422` (R19.4). */
export const createLead: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  void (async () => {
    const brokerId = await crmService.resolveBrokerId(user.id);
    const lead = await crmService.createLead(brokerId, req.body ?? {});
    res.status(201).json({ lead });
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to create lead'));
  });
};

/** `PUT /api/broker/leads/:id` — edit a lead (R19.4). */
export const updateLead: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  const leadId = req.params.id;
  if (!leadId) {
    next(AppError.badRequest('A lead id is required'));
    return;
  }

  void (async () => {
    const brokerId = await crmService.resolveBrokerId(user.id);
    const lead = await crmService.updateLead(brokerId, leadId, req.body ?? {});
    res.json({ lead });
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to update lead'));
  });
};

/** `DELETE /api/broker/leads/:id` — remove a lead (R19.4). */
export const deleteLead: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  const leadId = req.params.id;
  if (!leadId) {
    next(AppError.badRequest('A lead id is required'));
    return;
  }

  void (async () => {
    const brokerId = await crmService.resolveBrokerId(user.id);
    await crmService.deleteLead(brokerId, leadId);
    res.status(204).end();
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to delete lead'));
  });
};

// ---------------------------------------------------------------------------
// Team (R19.5)
// ---------------------------------------------------------------------------

/** `GET /api/broker/team` — list the broker's team members (R19.5). */
export const listTeam: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  void (async () => {
    const brokerId = await crmService.resolveBrokerId(user.id);
    const team = await crmService.listTeam(brokerId);
    res.json({ team });
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to list team members'));
  });
};

/**
 * `POST /api/broker/team` — add a team member with optional role/permissions;
 * missing `name` returns `422` (R19.5).
 */
export const addTeamMember: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  void (async () => {
    const brokerId = await crmService.resolveBrokerId(user.id);
    const member = await crmService.addTeamMember(brokerId, req.body ?? {});
    res.status(201).json({ member });
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to add team member'));
  });
};

/**
 * `POST /api/broker/team/:id` — assign or revoke a team member's role-based
 * permissions (R19.5).
 */
export const updateTeamPermissions: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  const memberId = req.params.id;
  if (!memberId) {
    next(AppError.badRequest('A team member id is required'));
    return;
  }

  void (async () => {
    const brokerId = await crmService.resolveBrokerId(user.id);
    const member = await crmService.updateTeamPermissions(brokerId, memberId, req.body ?? {});
    res.json({ member });
  })().catch((err: unknown) => {
    next(
      err instanceof AppError
        ? err
        : AppError.internal('Failed to update team member permissions'),
    );
  });
};

/** `DELETE /api/broker/team/:id` — remove a team member (R19.5). */
export const removeTeamMember: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  const memberId = req.params.id;
  if (!memberId) {
    next(AppError.badRequest('A team member id is required'));
    return;
  }

  void (async () => {
    const brokerId = await crmService.resolveBrokerId(user.id);
    await crmService.removeTeamMember(brokerId, memberId);
    res.status(204).end();
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to remove team member'));
  });
};

// ---------------------------------------------------------------------------
// Documents (R19.6)
// ---------------------------------------------------------------------------

/**
 * `GET /api/broker/documents` — list the broker's documents, optionally
 * filtered/categorized by client, policy, or category (R19.6).
 */
export const listDocuments: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  void (async () => {
    const brokerId = await crmService.resolveBrokerId(user.id);
    const filters: DocumentFilters = {
      clientId: queryString(req.query.clientId) ?? queryString(req.query.client),
      brokerPolicyId:
        queryString(req.query.brokerPolicyId) ??
        queryString(req.query.policyId) ??
        queryString(req.query.policy),
      category: queryString(req.query.category),
    };
    const documents = await crmService.listDocuments(brokerId, filters);
    res.json({ documents });
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to list documents'));
  });
};

/**
 * `POST /api/broker/documents` — upload a document (multipart `file`) and store
 * its metadata, categorized by client/policy (R19.6). Runs after the
 * `uploadSingle` chain, so `req.file` is a validated buffer.
 */
export const uploadDocument: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  const file = req.file;
  if (!file) {
    next(AppError.badRequest('No file provided'));
    return;
  }

  const body = (req.body ?? {}) as {
    name?: unknown;
    category?: unknown;
    clientId?: unknown;
    brokerPolicyId?: unknown;
    policyId?: unknown;
  };

  void (async () => {
    const brokerId = await crmService.resolveBrokerId(user.id);
    const document = await crmService.uploadDocument(brokerId, {
      filename: file.originalname,
      file: file.buffer,
      mimeType: file.mimetype,
      name: body.name,
      category: body.category,
      clientId: body.clientId,
      brokerPolicyId: body.brokerPolicyId ?? body.policyId,
    });
    res.status(201).json({ document });
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to upload document'));
  });
};

/** `DELETE /api/broker/documents/:id` — delete a document (R19.6). */
export const deleteDocument: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (!user) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  const documentId = req.params.id;
  if (!documentId) {
    next(AppError.badRequest('A document id is required'));
    return;
  }

  void (async () => {
    const brokerId = await crmService.resolveBrokerId(user.id);
    await crmService.deleteDocument(brokerId, documentId);
    res.status(204).end();
  })().catch((err: unknown) => {
    next(err instanceof AppError ? err : AppError.internal('Failed to delete document'));
  });
};
