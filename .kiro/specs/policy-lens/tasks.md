# Implementation Plan: PolicyLens

## Overview

This plan implements PolicyLens Phase 1 as a TypeScript monorepo: a Node.js/Express backend, a React (Vite + Tailwind) frontend, a shared types package, and Supabase (PostgreSQL + pgvector + Auth + Storage) as the data platform. Work proceeds bottom-up: scaffold and shared types first, then database/migrations, backend core, the provider-agnostic AI layer (with deterministic mock adapters so the product runs with zero external keys), policy-processing services, the background worker, then customer and broker APIs, then the two themed portals, integration tests, and documentation. Property-based tests (fast-check) cover the algorithmic invariants — Health Score bounds/monotonicity, chunking invariants, and the freemium upload limit.

## Tasks

- [x] 1. Project scaffold and shared types
  - [x] 1.1 Initialize monorepo workspace and root tooling
    - Create root `package.json` with npm workspaces (`shared`, `backend`, `frontend`) and root scripts: `lint`, `typecheck`, `test`, `dev:backend`, `dev:frontend`, `migrate`, `seed`
    - Add root `tsconfig.base.json`, ESLint + Prettier config, `.gitignore` (ignore `.env`), and `.env.example` documenting all env vars (server, Supabase, AI/embedding/OCR providers with mock defaults, limits, VITE_ vars)
    - Add optional `docker-compose.yml` for local Postgres + pgvector
    - _Requirements: 17.1, 18.1, 21.1_

  - [x] 1.2 Create shared types package
    - Define shared TypeScript types/interfaces in `shared/types`: `Policy`, `PolicyAnalysis`, `Coverage`, `Exclusion`, `WaitingPeriod`, `FinancialLimit`, `CoPay`, `HiddenClause`, `Recommendation`, `Job`/`JobStage`, `ChunkContext`, `GroundedAnswer`, `ComparisonResult`, `ClaimResult`, `Insight`, `PortfolioSummary`, role/tier/category enums, and API error shape `{ error: { code, message, details? } }`
    - Export a Zod schema for `PolicyAnalysis` mirroring the analysis JSON schema (used by backend validation and frontend forms)
    - _Requirements: 3.1, 3.9, 4.1, 5.2, 7.1, 8.3, 13.1_

  - [x] 1.3 Configure test tooling
    - Set up Vitest, fast-check, and Supertest in the backend workspace; Vitest in the frontend workspace
    - Add test scripts and a shared test config; wire into the root `test` script
    - _Requirements: 3.8, 15.1, 18.1_

- [x] 2. Database schema and migrations  
  - [x] 2.1 Create extension and profiles migrations
    - `001_extensions.sql`: `create extension if not exists vector;`
    - `002_profiles.sql`: `profiles` table (`user_id`, `full_name`, `email`, `role`, `tier`, `broker_id`) plus a trigger to create a profile row on `auth.users` signup
    - _Requirements: 17.1, 18.1_

  - [x] 2.2 Create customer-domain migration
    - `003_customer.sql`: `policies`, `policy_analysis`, `policy_chunks` (with `embedding vector(1536)` and `ivfflat (embedding vector_cosine_ops)` index), `family_members`, `chats`, `chat_messages`, `comparisons`, `claim_simulations`, `jobs`, `notifications` with columns per the data model
    - _Requirements: 4.1, 6.1, 6.2, 6.6, 7.1, 8.1, 15.1, 16.1_

  - [x] 2.3 Create broker-domain migration
    - `004_broker.sql`: `brokers`, `clients`, `broker_policies`, `renewals`, `commissions`, `claims`, `leads`, `team_members`, `documents`, `ai_insights`, `audit_log` with columns and status enums per the data model
    - _Requirements: 9.1, 10.1, 11.1, 12.1, 13.1, 19.4, 19.5, 19.6_

  - [x] 2.4 Create RLS policies and retrieval function migrations
    - `005_rls.sql`: enable RLS on every table; owner-scoped policies (`owner_id = auth.uid()` and via-parent for child tables), broker-scoped policies (`broker_id` belongs to caller's broker profile), and Storage bucket `policies` path-prefix policy
    - `006_functions.sql`: `match_policy_chunks(policy_id, query_embedding, threshold, k)` returning `1 - (embedding <=> query)` as similarity, filtered `>= threshold`, ordered desc, limited to k
    - `007_seed_hooks.sql`: optional demo seed toggles
    - _Requirements: 15.2, 17.5, 21.1_

  - [x] 2.5 Create migration runner and demo seed script
    - Add a migration runner that applies ordered SQL files (wired to root `migrate` script)
    - Add `backend/seed` script inserting a demo broker + clients + broker_policies + renewals + commissions + claims + leads so the broker portal is populated immediately
    - _Requirements: 9.1, 10.1, 11.1_

- [x] 3. Backend core infrastructure
  - [x] 3.1 Bootstrap Express app and configuration
    - Create `backend/src/index.ts` (Express bootstrap, CORS to `CLIENT_ORIGIN`, JSON parsing, route mounting under `/api`) and `config/` for env loading with typed access and startup validation
    - Add Supabase client factories (anon + service-role; service-role server-only)
    - _Requirements: 17.1_

  - [x] 3.2 Implement core middleware
    - `errorHandler` (central typed JSON errors with correct HTTP status: 400/401/403/404/409/413/422/429/500)
    - `authMiddleware` (verify Supabase JWT, attach `req.user`) and `rbacMiddleware(roles)` (deny cross-portal with 403 + message)
    - `uploadMiddleware` (Multer memory storage, MIME + size validation: PDF/JPEG/PNG, ≤ 20MB) and `rateLimiter` for AI/upload endpoints
    - _Requirements: 1.4, 1.5, 17.2, 17.4, 17.5, 5.7_

  - [x]* 3.3 Write unit tests for middleware
    - Test rbac role matching/denial, upload MIME + size rejection, and error handler status mapping
    - _Requirements: 1.4, 1.5, 17.2, 17.5_

- [x] 4. AI abstraction layer and mock adapters
  - [x] 4.1 Define provider interfaces and factory
    - Define `AIProvider`, `EmbeddingProvider`, `OCRProvider` interfaces in `services/ai`
    - Implement provider factory that selects adapters from env (`AI_PROVIDER`, `EMBEDDING_PROVIDER`, `OCR_PROVIDER`) and falls back to mock when required keys are absent, logging a startup banner of live vs mocked providers
    - _Requirements: 2.2, 3.1, 5.1, 15.1_

  - [x] 4.2 Implement mock adapters
    - `MockOCRProvider` (bundled sample health/motor/travel policy text, confidence 0.95), `MockAIProvider` (schema-valid deterministic `PolicyAnalysis`, chat answers with labeled citations, comparison, claim-sim), `MockEmbeddingProvider` (deterministic hash-based pseudo-embeddings)
    - _Requirements: 2.2, 3.1, 5.1, 5.2, 7.1, 8.1, 15.1_

  - [x] 4.3 Implement Google Vision OCR adapter
    - `GoogleVisionOCRProvider` implementing `extract(file, mime)` → `{ text, pages, confidence }`, wrapped with timeout + one retry
    - _Requirements: 2.2, 2.5, 2.6_

  - [x] 4.4 Implement Anthropic and OpenAI adapters
    - `AnthropicAIProvider` and `OpenAIAIProvider` for analysis/chat/compare/claim-sim/insights, and `OpenAIEmbeddingProvider` for embeddings; enforce strict-JSON prompting with one repair retry
    - _Requirements: 3.1, 3.10, 5.1, 5.2, 7.1, 8.1, 13.1, 15.1_

  - [x]* 4.5 Write unit tests for provider factory fallback
    - Verify missing keys select mock adapters and explicit `mock` values are honored
    - _Requirements: 3.1, 15.1_

- [x] 5. Policy processing services
  - [x] 5.1 Implement ParserService
    - Detect embedded selectable text (pdf-parse fast path) vs OCR route per page; route mixed PDFs page-by-page; preserve page order/boundaries; low-confidence (<60%) and OCR-unavailable handling surfaced to the job
    - Support ≥100-page documents
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [x] 5.2 Implement ChunkingService
    - Sentence-aware splitter targeting ≤512 tokens with ~15% overlap, preserving page/section metadata
    - _Requirements: 15.1_

  - [x]* 5.3 Write property test for chunking invariants
    - **Property: Chunking invariants** — every chunk ≤ max tokens, no empty chunk, order-preserving reconstruction of non-overlap content, overlap within bounds
    - **Validates: Requirements 15.1**

  - [x] 5.4 Implement embeddings generation and storage
    - Generate embeddings for each chunk via `EmbeddingProvider` and persist to `policy_chunks` with index/section/page metadata
    - _Requirements: 15.1, 15.4_

  - [x] 5.5 Implement AnalysisService
    - Call `AIProvider.analyzePolicy`, validate against the Zod schema, one repair retry then partial-result fallback (`partial=true`, populate `notFound`); explicit empty-category indication; compute risk-flag count
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.9, 3.10_

  - [x] 5.6 Implement HealthScoreService
    - Deterministic weighted 0–100 scoring in code (coverage gap, waiting period, exclusion, limit, co-pay penalties + claim-friendliness bonus, clamped) with named-constant weights and quality bands
    - _Requirements: 3.8, 4.3_

  - [x]* 5.7 Write property test for Health Score
    - **Property: Health Score bounds and monotonicity** — score ∈ [0,100] for any analysis input; adding an exclusion or increasing co-pay never raises the score
    - **Validates: Requirements 3.8**

- [x] 6. Background processing worker
  - [x] 6.1 Implement worker loop and stage pipeline
    - Worker claims `queued` jobs with `FOR UPDATE SKIP LOCKED`; runs parse/OCR → chunk+embed → analysis → done; writes `stage`/`progress` (`queued 0 → ocr 25 → embedding 55 → analysis 80 → done 100`) on each transition; notifies on completion
    - _Requirements: 16.1, 16.2, 16.3_

  - [x] 6.2 Implement failure handling, retry, concurrency, and queueing
    - Record `status=failed`, `failed_stage`, `error`, increment `attempts`; allow retry ≤ 3; enforce per-user concurrency cap of 5 with computed `queue_position`; set `extended=true` for >50-page docs
    - _Requirements: 16.4, 16.6, 16.7_

  - [x]* 6.3 Write unit tests for worker state transitions
    - Test stage/progress transitions, retry cap at 3, concurrency queueing, and extended flag
    - _Requirements: 16.2, 16.4, 16.6, 16.7_

- [x] 7. Customer API and services
  - [x] 7.1 Implement PolicyService upload and job creation
    - `POST /policies` (multipart): store file in Supabase Storage (owner-namespaced path), create `policies` + `jobs` rows, return job acknowledgment; storage-unavailable and freemium checks surfaced as typed errors
    - _Requirements: 1.1, 1.2, 1.3, 16.1, 21.1, 21.2, 21.5_

  - [x] 7.2 Implement freemium enforcement
    - Enforce free-tier 3-policy upload limit (reject with upgrade prompt), gate premium features (Claim Simulator, Comparison, family vault, renewal tracking), and grant instant access on upgrade
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6_

  - [ ]* 7.3 Write property test for freemium upload limit
    - **Property: Free-tier upload cap** — for any sequence of upload attempts, a free user's stored policy count never exceeds the tier limit
    - **Validates: Requirements 18.1, 18.5**

  - [x] 7.4 Implement vault, dashboard, download, delete, and job-status endpoints
    - `GET /policies` (filter by q/category/member within 2s), `GET /policies/:id` (dashboard payload), `GET /policies/:id/download` (signed URL), `DELETE /policies/:id` (cascade analysis/chunks/text/storage), `GET /jobs/:id`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 6.3, 6.4, 6.5, 6.7, 16.2, 21.3_

  - [x] 7.5 Implement family members endpoints
    - `GET/POST /family-members` to create and assign named family members to policies
    - _Requirements: 6.6_

  - [x] 7.6 Implement ChatService (RAG) and semantic search
    - `POST /policies/:id/chat`: reject >500 chars, embed question, retrieve top-5 chunks via `match_policy_chunks`, generate grounded plain-English answer (≤8th-grade) with ≥1 cited section, refuse when unsupported, handle still-processing policy; `POST /policies/:id/search` returns up to 10 chunks ≥0.7 similarity with match % ordered desc, empty-state message; `GET /policies/:id/chat/:chatId` history
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 15.2, 15.3, 15.4, 15.5_

  - [x] 7.7 Implement CompareService and ClaimSimService endpoints
    - `POST /compare`: structured A/B comparison + Health-Score-based recommendation, error when a policy lacks completed analysis; `POST /policies/:id/claim-sim`: evaluate scenario (waiting periods, coverage, exclusions, limits, co-pay) → probability + reasons + satisfied items + matched-exclusion/insufficient-detail/not-covered handling
    - _Requirements: 7.1, 7.2, 7.3, 7.5, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

  - [x] 7.8 Implement guest preview endpoint
    - `POST /try/analyze` (public, multipart): single ephemeral, non-persisted analysis; rate-limited and size-capped
    - _Requirements: 17.3, 20.7_

- [x] 8. Checkpoint - customer backend
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Broker API and services
  - [x] 9.1 Implement broker dashboard aggregation
    - `GET /broker/dashboard`: total premium (YTD), active policies, total clients, renewals due (30d), pending claims, 12-month premium chart by type, commission overview (total/paid/pending/overdue to 2 decimals), risk strip, insights, zero/empty states
    - _Requirements: 9.1, 9.2, 9.3, 9.6, 13.1_

  - [x] 9.2 Implement clients CRUD and risk dashboard
    - `GET/POST/PUT /broker/clients` + profile (details, associated policies, coverage gaps) with required-field validation (422 + missing fields); filter by name/type/risk/renewal within 3s; `GET /broker/clients/risk` counts (underinsured, missing family coverage, high deductible >₹50,000, waiting periods ending in 30d, no health insurance)
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [x] 9.3 Implement policies CRUD, renewals, and premium tracker
    - `GET/POST/PUT /broker/policies` (paginated ≤50/page, status derivation, validation incl. end-date-before-start with data preservation → 422); `GET /broker/renewals` (≤90d, distinct <30d indicator); `POST /broker/renewals/remind` (send + confirmation count + failed-recipient retry); `GET /broker/premiums` (Paid/Pending/Overdue, 12-month charts by type)
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7_

  - [x] 9.4 Implement commission and claims management
    - `GET /broker/commission` overview; `GET/POST /broker/claims` (≤50/page, status, filters with no-results message, Claim Assistant sequential submission with missing-field prevention, status-change notifications)
    - _Requirements: 9.3, 12.1, 12.2, 12.3, 12.4, 12.5_

  - [x] 9.5 Implement leads, team, and documents
    - `GET/POST/PUT/DELETE /broker/leads`; `GET/POST/DELETE /broker/team` (permission assign/revoke); `GET/POST/DELETE /broker/documents` (categorize by client/policy, upload/download/delete)
    - _Requirements: 19.4, 19.5, 19.6_

  - [x] 9.6 Implement InsightsService and reports/analytics
    - `GET /broker/insights`: portfolio analysis → categorized recommendations (upsell/risk_alert/renewal_opt/coverage_improvement) with affected clients + evidence, coverage-gap inclusion within 60s, refresh ≥ every 24h, unavailable fallback with last-generated timestamp; `GET /broker/reports` and `GET /broker/analytics` (policy volume, premium revenue, claims activity, commission)
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 19.7_

  - [x]* 9.7 Write unit tests for broker validation and derived metrics
    - Test client/policy required-field validation, end-date validation, commission overdue derivation, and risk-dashboard counts
    - _Requirements: 9.3, 10.3, 10.5, 11.6_

- [x] 10. Frontend foundation
  - [x] 10.1 Scaffold Vite app and theming
    - Create Vite + React + TS app, Tailwind with dual-theme tokens (customer dark navy `#0B1220`/teal `#2DD4BF`; broker light + navy sidebar `#1E293B`/blue `#2563EB`), `ThemeContext` setting `data-theme`
    - _Requirements: 19.3, 20.5_

  - [x] 10.2 Implement API client, Supabase client, query client, and auth context
    - `lib/` api client (Bearer JWT, 401 interceptor → `/login?redirect=<intended>`), Supabase client, React Query client, `AuthContext` loading session + `profile.role`
    - _Requirements: 17.1, 17.4_

  - [x] 10.3 Implement role routing and layouts
    - `RoleRoute allow={[...]}` guard, `PublicLayout`, `CustomerLayout`, `BrokerLayout`, and `App.tsx` route table
    - _Requirements: 17.2, 17.5_

- [x] 11. Customer portal UI
  - [x] 11.1 Build landing page
    - Exact headline "Insurance policies are written to be skimmed past. We read them anyway.", four-step (Upload → Extract → Analyze → Decide), coverage types + scanned/typed PDF note, message "No account needed to preview. Results in under 40 seconds", dark theme, footer sections (Product/Coverage Types/Company), primary CTA to upload flow
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.7_

  - [x] 11.2 Build auth pages and guest preview
    - Login/Signup pages and `/try` guest single-policy preview flow
    - _Requirements: 17.1, 17.3_

  - [x] 11.3 Build upload and processing status
    - `UploadDropzone`, client-side format/size messaging, `ProcessingStatus` polling `GET /jobs/:id` (2s) rendering Upload → Extract → Analyze → Done, failure/timeout (120s) with retry
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 16.2_

  - [x] 11.4 Build policy dashboard
    - `HealthScoreGauge` with quality bands, `RiskFlagCard` count above the fold, coverage/exclusions/waiting-periods (grouped) lists, `ClauseCard` plain-English, up to 5 recommendations (gap vs risk), no-risk-flags and no-recommendations states, premium/sum insured/provider
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 11.5 Build chat and search UI
    - `ChatPanel` with cited-clause chips and length cap, `SearchResults` with match % ordered desc and empty state
    - _Requirements: 5.1, 5.2, 5.5, 5.7, 15.3, 15.5_

  - [x] 11.6 Build vault, compare, claim simulator, and upgrade pages
    - Vault (list/filter by name/type/provider/member, download, delete confirmation), `CompareTable` (A vs B, superior indicators, 0–100 scores), `ClaimChecklist` (satisfied/warn + probability), upgrade page with feature-named prompt + pricing
    - _Requirements: 6.2, 6.3, 6.4, 6.5, 7.3, 7.4, 8.3, 8.4, 18.2, 18.4_

- [x] 12. Broker portal UI
  - [x] 12.1 Build broker sidebar and dashboard
    - Persistent `Sidebar` (14 sections) with active-section highlight; dashboard KPI `StatCard`s, `PremiumChart`, `BusinessMixDonut`, `CommissionBreakdown`, `RenewalCalendar`, `RiskDashboardStrip`, `AIInsightList`, auto-refresh ≤60s, and `QuickActionsBar` with exactly 8 actions (visible without scrolling ≥1024px, prerequisite guards)
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 13.3, 13.4, 14.1, 14.2, 14.3, 14.4, 19.1, 19.2, 19.3_

  - [x] 12.2 Build clients and policies pages
    - Clients (CRUD, profile with policies + coverage gaps, filters, risk dashboard, missing-field errors); Policies (`DataTable` paginated ≤50/page, add/edit with validation + data preservation, status display)
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 11.1, 11.6, 19.8_

  - [x] 12.3 Build renewals, premiums, and commission pages
    - `RenewalCalendar` (≤90d, <30d distinct indicator, send reminders + confirmation/failed retry), `PremiumTracker` (status + 12-month charts by type), commission overview (2-decimal amounts)
    - _Requirements: 9.3, 11.2, 11.3, 11.4, 11.5, 11.7_

  - [x] 12.4 Build claims, leads, and AI assistant pages
    - Claims (status, filters + no-results, `ClaimAssistant` sequential workflow + missing-field prevention, notifications), Leads CRUD, AI Assistant categorized insights with clients/attribute/explanation + unavailable fallback
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 13.3, 13.4, 13.5, 19.4_

  - [x] 12.5 Build reports, analytics, documents, team, and settings pages
    - Reports/Analytics (policy volume, premium revenue, claims activity, commission), Documents (upload/download/delete/categorize), Team (add/remove + permissions), Settings
    - _Requirements: 19.5, 19.6, 19.7, 19.8_

- [x] 13. Checkpoint - full stack wired
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 14. Integration tests
  - [ ]* 14.1 Write processing pipeline integration test
    - upload → job → analysis happy path against mock providers, asserting stage progression and dashboard payload
    - _Requirements: 1.1, 3.1, 16.1, 16.2_

  - [ ]* 14.2 Write chat, search, compare, and claim-sim integration tests
    - Chat grounding + refusal + citation, semantic search threshold/empty state, comparison, claim-sim probability/reasons
    - _Requirements: 5.1, 5.2, 5.4, 7.1, 8.3, 15.2_

  - [ ]* 14.3 Write broker and RBAC integration tests
    - Broker CRUD + validation (422), and RBAC cross-portal denial (403)
    - _Requirements: 10.5, 11.6, 17.2, 17.5_

- [x] 15. Documentation deliverables
  - [x]* 15.1 Write SRS.md and README.md
    - `SRS.md` (repo root): full SRS traceable to R1–R21, non-functional requirements, external interfaces, data requirements, constraints, assumptions, future phases 2–8, and glossary
    - `README.md`: overview, architecture, prerequisites, Supabase setup, migrations, env configuration, running frontend/backend, demo/mock mode, seeding demo broker data, testing, and where to add API keys
    - _Requirements: 17.1, 21.1_

- [x] 16. Final verification
  - Run `lint`, `typecheck`, and the full test suite (unit + property-based + integration) against mock providers and fix any failures
  - _Requirements: all_

## Notes

- Tasks marked with `*` are optional (tests and documentation) and can be skipped for a faster MVP, though they are strongly recommended.
- Each task references the specific requirements it satisfies for traceability.
- Checkpoints ensure incremental validation at natural boundaries.
- Property-based tests (fast-check) validate universal correctness properties: Health Score bounds/monotonicity (Property in 5.7), chunking invariants (5.3), and the freemium upload cap (7.3).
- Unit and integration tests validate specific examples, edge cases, and end-to-end flows.
- All work runs end-to-end with zero external keys via the deterministic mock adapters.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1", "2.2", "2.3", "4.1", "10.1"] },
    { "id": 3, "tasks": ["2.4", "3.1", "4.2", "4.3", "4.4", "10.2"] },
    { "id": 4, "tasks": ["2.5", "3.2", "4.5", "5.1", "5.2", "5.5", "5.6", "10.3"] },
    { "id": 5, "tasks": ["3.3", "5.3", "5.4", "5.7", "6.1", "11.1", "11.2"] },
    { "id": 6, "tasks": ["6.2", "6.3", "7.1", "7.2", "9.1", "11.3"] },
    { "id": 7, "tasks": ["7.3", "7.4", "7.5", "7.6", "7.7", "7.8", "9.2", "9.3", "9.4", "9.5", "9.6", "11.4", "11.5", "11.6"] },
    { "id": 8, "tasks": ["9.7", "12.1", "12.2", "12.3", "12.4", "12.5"] },
    { "id": 9, "tasks": ["14.1", "14.2", "14.3", "15.1"] }
  ]
}
```
