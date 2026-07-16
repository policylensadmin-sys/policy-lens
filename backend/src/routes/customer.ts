// Customer portal routes (mounted under `/api`).
//
// Wires the customer-facing endpoints to their middleware chains and
// controllers. Every route requires an authenticated user with the `customer`
// role (RBAC denies cross-portal access with 403, R17.2/R17.5).
//
// Endpoints:
//   POST   /policies              — multipart upload → store file, create policy + job (R1/R16/R21).
//   GET    /policies              — list vault, filter by q/category/member (R6.3/R6.6).
//   GET    /policies/:id          — dashboard payload (policy + analysis) (R4).
//   GET    /policies/:id/download — signed download URL for the document (R6.4/R21.3).
//   DELETE /policies/:id          — delete policy + cascade analysis/chunks/text/storage (R6.5).
//   GET    /jobs/:id              — background job status/progress (R16.2).
//   POST   /compare               — compare two owned policies (R7).
//   POST   /policies/:id/claim-sim — simulate a claim scenario (R8).
//   GET    /family-members        — list named household members (R6.6).
//   POST   /family-members        — create a named household member (R6.6).
//
// Additional customer endpoints (guest preview) mount here in a later task (7.8).

import { Router } from 'express';

import {
  askQuestion,
  getChatHistory,
  searchPolicy,
} from '../controllers/chatController';
import {
  comparePolicies,
  simulateClaim,
} from '../controllers/compareController';
import {
  createFamilyMember,
  listFamilyMembers,
} from '../controllers/familyController';
import {
  deletePolicy,
  downloadPolicy,
  getJobStatus,
  getPolicyDashboard,
  listPolicies,
  uploadPolicy,
} from '../controllers/policyController';
import { aiRateLimiter, authMiddleware, rbacMiddleware, uploadSingle } from '../middleware/index';

/** Router carrying the customer portal API surface. */
export const customerRouter = Router();

// All customer routes require an authenticated user with the `customer` role.
customerRouter.use(authMiddleware, rbacMiddleware('customer'));

// POST /api/policies — authenticated customer upload (multipart `file`).
customerRouter.post('/policies', ...uploadSingle, uploadPolicy);

// GET /api/policies — vault list with optional q/category/member filters.
customerRouter.get('/policies', listPolicies);

// GET /api/policies/:id — dashboard payload for a single policy.
customerRouter.get('/policies/:id', getPolicyDashboard);

// GET /api/policies/:id/download — short-lived signed download URL.
customerRouter.get('/policies/:id/download', downloadPolicy);

// DELETE /api/policies/:id — delete policy and cascade its derived data.
customerRouter.delete('/policies/:id', deletePolicy);

// GET /api/jobs/:id — processing job status/progress (polled by the client).
customerRouter.get('/jobs/:id', getJobStatus);

// POST /api/policies/:id/chat — ask a grounded question about the policy (RAG).
customerRouter.post('/policies/:id/chat', aiRateLimiter, askQuestion);

// GET /api/policies/:id/chat/:chatId — chat message history for a thread.
customerRouter.get('/policies/:id/chat/:chatId', getChatHistory);

// POST /api/policies/:id/search — semantic search over the policy's clauses.
customerRouter.post('/policies/:id/search', aiRateLimiter, searchPolicy);

// POST /api/compare — compare two owned policies (premium, R7/R18.2).
customerRouter.post('/compare', aiRateLimiter, comparePolicies);

// POST /api/policies/:id/claim-sim — simulate a claim scenario (premium, R8/R18.2).
customerRouter.post('/policies/:id/claim-sim', aiRateLimiter, simulateClaim);

// GET /api/family-members — list the caller's named household members (R6.6).
customerRouter.get('/family-members', listFamilyMembers);

// POST /api/family-members — create a named household member (R6.6).
customerRouter.post('/family-members', createFamilyMember);
