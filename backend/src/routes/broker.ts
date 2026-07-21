// Broker portal routes (mounted under `/api/broker`).
//
// Wires the broker-facing endpoints to their middleware chains and controllers.
// Every route requires an authenticated user with the `broker` role; RBAC
// denies cross-portal access with 403 (R17.2/R17.5). Auth + RBAC are applied at
// the router level so all broker endpoints inherit the guard.
//
// Endpoints (task 9.2 — client management + risk dashboard, R10):
//   GET  /broker/clients        — search/filter clients (R10.1/R10.4)
//   GET  /broker/clients/risk   — Client Risk Dashboard counts (R10.3)
//   POST /broker/clients        — add client + associated policies (R10.1/R10.5)
//   GET  /broker/clients/:id    — client profile w/ policies + coverage gaps (R10.2)
//   PUT  /broker/clients/:id    — edit client core fields (R10.1/R10.5)
//
// Further broker endpoints (dashboard, policies, renewals, commission, claims,
// leads, insights, …) mount onto this router in sibling tasks.

import { Router } from 'express';

import {
  createClient,
  getClient,
  getClientRiskDashboard,
  listClients,
  updateClient,
} from '../controllers/brokerController';
import {
  createPolicy,
  getPremiumTracker,
  getRenewalCalendar,
  listPolicies,
  sendRenewalReminders,
  updatePolicy,
} from '../controllers/brokerPolicyController';
import {
  getCommissionOverview,
  listClaims,
  submitClaim,
  updateClaimStatus,
} from '../controllers/brokerClaimsController';
import {
  addTeamMember,
  createLead,
  deleteDocument,
  deleteLead,
  listDocuments,
  listLeads,
  listTeam,
  removeTeamMember,
  updateLead,
  updateTeamPermissions,
  uploadDocument,
} from '../controllers/brokerCrmController';
import {
  getAnalytics,
  getInsights,
  getReports,
} from '../controllers/brokerInsightsController';
import { askAssistant } from '../controllers/brokerAssistantController';
import {
  commitImport,
  downloadTemplate,
  previewImport,
} from '../controllers/brokerImportController';
import { getBrokerDashboard } from '../controllers/brokerDashboardController';
import { aiRateLimiter, authMiddleware, rbacMiddleware, uploadSingle } from '../middleware/index';

/** Router carrying the broker portal API surface (mounted at `/api/broker`). */
export const brokerRouter = Router();

// All broker routes require an authenticated broker.
brokerRouter.use(authMiddleware, rbacMiddleware('broker'));

// Aggregated dashboard payload (KPIs, premium chart, commission, insights) (R9, R13).
brokerRouter.get('/dashboard', getBrokerDashboard);

// Client management + risk dashboard (R10). The static `/clients/risk` route is
// declared before the `/clients/:id` param route so it is not shadowed.
brokerRouter.get('/clients', listClients);
brokerRouter.get('/clients/risk', getClientRiskDashboard);
brokerRouter.post('/clients', createClient);
brokerRouter.get('/clients/:id', getClient);
brokerRouter.put('/clients/:id', updateClient);

// Policy management, renewal calendar, and premium tracker (R11). The static
// `/renewals/remind` route is declared before any param routes so it is not
// shadowed.
brokerRouter.get('/policies', listPolicies);
brokerRouter.post('/policies', createPolicy);
brokerRouter.put('/policies/:id', updatePolicy);
brokerRouter.get('/renewals', getRenewalCalendar);
brokerRouter.post('/renewals/remind', sendRenewalReminders);
brokerRouter.get('/premiums', getPremiumTracker);

// Commission overview + claims management, including the Claim Assistant (R9.3,
// R12). Claims are scoped to the broker via their policies; status changes emit
// an in-app notification to the broker.
brokerRouter.get('/commission', getCommissionOverview);
brokerRouter.get('/claims', listClaims);
brokerRouter.post('/claims', submitClaim);
brokerRouter.put('/claims/:id/status', updateClaimStatus);

// AI insights (categorized portfolio recommendations, R13) and reports /
// analytics aggregations (policy volume, premium revenue, claims activity,
// commission earned, R19.7).
brokerRouter.get('/insights', getInsights);
brokerRouter.get('/reports', getReports);
brokerRouter.get('/analytics', getAnalytics);

// "Ask Lens" AI assistant: answers a broker's free-text question grounded in
// their portfolio insights + summary (R13). Rate-limited like other AI routes.
brokerRouter.post('/assistant', aiRateLimiter, askAssistant);

// Leads pipeline CRUD (R19.4).
brokerRouter.get('/leads', listLeads);
brokerRouter.post('/leads', createLead);
brokerRouter.put('/leads/:id', updateLead);
brokerRouter.delete('/leads/:id', deleteLead);

// Team management: list/add/remove members and assign/revoke role-based
// permissions (R19.5). `POST /team/:id` patches an existing member's
// permissions; `POST /team` adds a new member.
brokerRouter.get('/team', listTeam);
brokerRouter.post('/team', addTeamMember);
brokerRouter.post('/team/:id', updateTeamPermissions);
brokerRouter.delete('/team/:id', removeTeamMember);

// SAFE CSV bulk-import (clients & policies). Two-step: preview (validate, no
// writes) → commit (server-side re-validate, then insert). A GET template route
// serves the canonical header + example row. `:entity` ∈ {clients, policies}.
brokerRouter.get('/import/:entity/template', downloadTemplate);
brokerRouter.post('/import/:entity/preview', previewImport);
brokerRouter.post('/import/:entity/commit', commitImport);

// Documents: list (categorized by client/policy), upload (multipart file →
// Supabase Storage + metadata), and delete (R19.6). The upload route runs the
// `uploadSingle` chain so `req.file` is a validated PDF/JPEG/PNG buffer.
brokerRouter.get('/documents', listDocuments);
brokerRouter.post('/documents', ...uploadSingle, uploadDocument);
brokerRouter.delete('/documents/:id', deleteDocument);
