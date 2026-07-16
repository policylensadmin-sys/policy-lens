# Software Requirements Specification (SRS)
## PolicyLens — AI-Powered Insurance Intelligence Platform

**Version:** 1.0 (Phase 1)
**Status:** Implemented — Phase 1 complete
**Related documents:** [`README.md`](README.md), [`.kiro/specs/policy-lens/requirements.md`](.kiro/specs/policy-lens/requirements.md), [`.kiro/specs/policy-lens/design.md`](.kiro/specs/policy-lens/design.md)

---

## 1. Introduction

### 1.1 Purpose
This SRS defines the requirements for **PolicyLens**, an AI-powered platform that transforms complex insurance policy documents into clear, personalized, actionable guidance. It is the authoritative reference for what Phase 1 delivers and the roadmap beyond. It is written for developers, reviewers, and anyone taking over or extending the project.

### 1.2 Scope
PolicyLens is **not** a policy marketplace; it makes insurance *understandable*. Phase 1 delivers three capabilities:

1. **Customer Portal** — individuals/families upload policies (PDF/scan/photo) and receive plain-English analysis, a Health Score, grounded AI chat, semantic search, policy comparison, and a claim simulator, organized in a Policy Vault.
2. **Broker Portal (CMS/CRM)** — brokers manage clients, policies, renewals, premiums, commissions, claims, leads, team, and documents, with AI-generated business insights.
3. **AI Engine** — shared OCR + structured analysis + RAG chat + semantic search, with an asynchronous processing pipeline.

Out of scope for Phase 1 (see §9 Roadmap): buying/selling policies, corporate/employer portal, hospital integration, mobile apps, payments.

Tagline: *"Understand your insurance before you need it."*

### 1.3 Definitions, Acronyms, Abbreviations
See the **Glossary (§10)**. Key terms: *Health Score, Policy Vault, Claim Simulator, Vector Store, Policy Chunk, Background Processor, Coverage Gap, RAG (Retrieval-Augmented Generation), RLS (Row-Level Security), OCR, EARS*.

### 1.4 References
- Requirements (EARS): `.kiro/specs/policy-lens/requirements.md`
- Design (architecture/data/API): `.kiro/specs/policy-lens/design.md`
- Supabase, pgvector, Google Cloud Vision, Anthropic, OpenAI documentation.

---

## 2. Overall Description

### 2.1 Product Perspective
A TypeScript monorepo:
- **Frontend:** React + Vite + Tailwind (single SPA, role-based routing, two themes).
- **Backend:** Node.js + Express (layered: routes → controllers → services → repositories) + a Postgres-backed background worker.
- **Data platform:** Supabase — PostgreSQL + **pgvector**, Auth (JWT), Storage.
- **AI:** provider-agnostic abstraction (`AIProvider`, `EmbeddingProvider`, `OCRProvider`) with adapters for **Mock**, **Anthropic**, **OpenAI / OpenAI-compatible (e.g. Groq)**, and **Google Vision**. A **mock mode** makes the entire product runnable with no external keys.

### 2.2 User Classes
| User class | Needs |
|-----------|-------|
| **Individual policyholder** | Understand own policy, avoid surprises, ask questions, simulate claims |
| **Family manager** | Store & organize multiple family members' policies |
| **Insurance broker** | Manage clients/policies/renewals/commissions/claims; AI upsell & risk insights |
| **Prospect (guest)** | Preview analysis without an account |
| **(Future) Employer / Hospital / Agent** | Group insurance, coverage verification, sales support |

### 2.3 Operating Environment
Modern web browsers; Node.js ≥ 18.18 server runtime; Supabase-hosted Postgres (with `vector` extension) and Storage.

### 2.4 Design & Implementation Constraints
- Secrets only server-side; service-role key never shipped to the browser.
- Every table protected by **RLS**; access scoped by owner/broker.
- Async processing must not block the request thread; progress surfaced to the UI.
- Must degrade gracefully when external providers are missing (mock fallback) or return invalid output (partial analysis).

### 2.5 Assumptions & Dependencies
- A Supabase project is provisioned with the `policies` storage bucket and migrations applied.
- For real AI/OCR, valid provider keys are configured; otherwise mock adapters are used.
- Users own the documents they upload and consent to processing.

---

## 3. Functional Requirements (traceability)

Requirements are specified in EARS form in `requirements.md` (R1–R21). Summary and traceability to design components below.

| # | Requirement | Summary | Key components |
|---|-------------|---------|----------------|
| R1 | Policy Document Upload | Accept PDF/JPEG/PNG/scan ≤20MB; async processing with progress; error/retry | UploadDropzone, uploadMiddleware, PolicyService, jobs, ProcessingStatus |
| R2 | OCR Text Extraction | pdf-parse fast path; Google Vision for scans; page order preserved; low-confidence/error handling | ParserService, OCRProvider (Google/Mock) |
| R3 | AI Policy Analysis | Structured coverage/exclusions/waiting periods/limits/co-pay/deductibles/hidden clauses; partial fallback; Health Score | AnalysisService, AIProvider, HealthScoreService |
| R4 | Policy Dashboard | Premium, sum insured, provider, Health Score bands, risk flags, recommendations | PolicyDashboard, HealthScoreGauge, RiskFlagCard |
| R5 | AI Insurance Chat | Grounded answers with cited sections; refuses ungrounded; ≤500 chars; plain English | ChatService (RAG), match_policy_chunks |
| R6 | Policy Vault | Store/categorize (Health/Life/Motor/Travel/Home), search, download, delete, family members | Vault, policies, family_members |
| R7 | Policy Comparison | Structured A/B compare + recommendation + 0–100 scores | CompareService, CompareTable |
| R8 | Claim Simulator | Scenario → approval probability + reasons + satisfied/exclusion checks | ClaimSimService, ClaimChecklist |
| R9 | Broker Dashboard | YTD premium, active policies, clients, renewals due, pending claims; charts; commission | Broker Dashboard, StatCard, PremiumChart, CommissionBreakdown |
| R10 | Broker Client Management | CRUD, profile with policies + coverage gaps, risk dashboard, filters | BrokerService, Clients page, RiskDashboardStrip |
| R11 | Broker Policy Management | CRUD (paginated), renewal calendar, premium tracker, reminders, validation | Policies/Renewals/Premiums pages |
| R12 | Broker Claims Management | Status tracking, filters, notifications, Claim Assistant workflow | Claims page, ClaimAssistant |
| R13 | Broker AI Insights | Categorized recommendations w/ clients + evidence; refresh; fallback | InsightsService, AIInsightList |
| R14 | Broker Quick Actions | Exactly 8 dashboard shortcuts with prerequisite guards | QuickActionsBar |
| R15 | Vector Semantic Search | Chunk + embed; cosine top-k ≥0.7; match %; grounds chat | ChunkingService, EmbeddingsService, SearchService |
| R16 | Background Processing | Job queue; stage/progress; retry ≤3; concurrency + queueing | Worker, jobs table |
| R17 | Auth & Authorization | Supabase Auth; RBAC per portal; guest preview; session-expiry redirect | authMiddleware, rbacMiddleware, RoleRoute |
| R18 | Freemium Access Control | Free tier upload cap (3) + feature gating; instant upgrade | tier checks, UpgradePrompt |
| R19 | Broker Navigation & Structure | 14-section sidebar; leads/team/documents/reports/analytics | Sidebar, broker pages |
| R20 | Customer Landing Page | Exact hero copy, four-step, coverage types, footer, CTA; dark theme | Landing |
| R21 | Policy Document Storage | Owner-scoped Storage; retain original + text + analysis; download; deletion cleanup | Supabase Storage, RLS |

Full acceptance criteria (WHEN/IF/WHILE/THE…SHALL) for each are in `requirements.md`.

---

## 4. External Interface Requirements

### 4.1 User Interfaces
- **Public** (dark theme): Landing, Login, Signup, guest Try preview.
- **Customer portal** (`/app/*`, dark navy + teal): Upload, Policy Dashboard, Chat, Vault, Compare, Claim Simulator, Upgrade.
- **Broker portal** (`/broker/*`, light + navy sidebar): Dashboard, Clients, Policies, Renewals, Premiums, Commission, Claims, Leads, AI Assistant, Reports, Analytics, Documents, Team, Settings.

### 4.2 Software Interfaces (REST API, `/api`)
- **Auth/Profile:** `GET /me`.
- **Customer:** `POST /policies` (multipart), `GET /policies`, `GET /policies/:id`, `GET /policies/:id/download`, `DELETE /policies/:id`, `GET /jobs/:id`, `POST /policies/:id/chat`, `POST /policies/:id/search`, `POST /compare`, `POST /policies/:id/claim-sim`, `GET/POST /family-members`, `POST /try/analyze` (public).
- **Broker:** `GET /broker/dashboard`, `/broker/clients` (+ `/risk`), `/broker/policies`, `/broker/renewals` (+ `/remind`), `/broker/premiums`, `/broker/commission`, `/broker/claims`, `/broker/leads`, `/broker/insights`, `/broker/team`, `/broker/documents`, `/broker/reports`, `/broker/analytics`.
- Errors use `{ error: { code, message, details? } }` with appropriate HTTP status.

### 4.3 External Services
- **Supabase** (Auth, Postgres+pgvector, Storage).
- **LLM** (Anthropic / OpenAI / OpenAI-compatible) and **Google Vision OCR**, each behind an interface with a mock fallback.

---

## 5. Data Requirements

Core entities (see `design.md` for full columns and the ER diagram):
`profiles` (role, tier), `policies`, `policy_analysis`, `policy_chunks` (vector(1536) + ivfflat), `family_members`, `chats`, `chat_messages`, `comparisons`, `claim_simulations`, `jobs`, `notifications`; broker domain: `brokers`, `clients`, `broker_policies`, `renewals`, `commissions`, `claims`, `leads`, `team_members`, `documents`, `ai_insights`, `audit_log`.

- **Retention:** originals + extracted text + analysis retained while the account exists; account deletion removes all associated data within 30 days.
- **Isolation:** RLS scopes every row to its owner (customer) or broker.

---

## 6. Non-Functional Requirements

| Category | Requirement |
|----------|-------------|
| **Performance** | Standard docs (≤50 pages) processed within ~40s; chat answers within ~10s; broker dashboard within ~5s. |
| **Scalability** | Support 100+ page documents; per-user job concurrency cap with queueing. |
| **Reliability** | Provider timeouts + one retry; job retry ≤3; graceful mock fallback; partial-analysis fallback on invalid LLM output. |
| **Security** | RLS on all tables; role-based route guards; server-only secrets; file type + size validation with content sniffing; rate limiting on AI/upload/guest endpoints; input length caps. |
| **Privacy** | Grounded answers only from the user's document; no cross-tenant access; deletion cleanup. |
| **Usability** | Plain-English output (≈8th-grade reading level); accessible, responsive UI; clear processing progress. |
| **Maintainability** | Layered architecture; provider abstraction; typed shared models; unit + property-based + component tests run on mocks in CI. |
| **Portability** | OpenAI-compatible base URL support (Groq/Together/local); Dockerized local Postgres option. |

---

## 7. System Models

- **Processing pipeline:** `upload → parse/OCR → chunk+embed → analyze+score → done`, driven by the `jobs` queue with stage/progress updates polled by the UI.
- **RAG:** embed query → cosine search `policy_chunks` (`match_policy_chunks`) → grounded LLM answer with cited sections.
- **Auth/RBAC:** Supabase JWT verified server-side; `profile.role` gates both frontend routes and backend endpoints.

(Mermaid diagrams in `design.md`.)

---

## 8. Verification & Validation

- **Unit tests** for services, middleware, and validation.
- **Property-based tests** (fast-check): Health Score always ∈ [0,100] and monotonic (more exclusions / higher co-pay never raise the score); chunking invariants (size, non-empty, order, overlap bound).
- **Component tests** for customer and broker UI, API client, and route guards.
- **Build & typecheck** across all workspaces.
- Current status: **231 tests passing**, production build succeeds, backend/shared/frontend typecheck clean.
- **Recommended next:** end-to-end HTTP integration tests (upload→job→analysis; chat grounding/refusal; broker CRUD + RBAC denial) — scaffolding and mocks are already in place.

---

## 9. Roadmap (Future Phases)

1. **Phase 1 — Consumer AI App + Broker CMS** *(this release)*.
2. **Phase 2 — Family Insurance Manager & Corporate/Employer portal** (manage employee group insurance, benefits explanation, HR analytics).
3. **Phase 3 — Insurance Marketplace** (compare & purchase, subject to regulatory approval).
4. **Phase 4 — Claim Intelligence** (historical claim data, with privacy safeguards, to sharpen guidance).
5. **Phase 5 — Hospital Integration** (coverage verification, required documents, pre-authorization).
6. **Phase 6 — Broker CRM enhancements** (deeper pipeline, AI recommendations).
7. **Phase 7 — Enterprise Platform** (employee insurance, benefits, claims analytics at scale).
8. **Phase 8 — International Expansion** (US/UK/UAE/Singapore/Australia; local products & regulations).

Future AI features: personalized recommendations, renewal optimization, coverage-gap detection, multilingual support, WhatsApp/voice assistants, email policy import, medical-bill analysis, claim-document verification.

---

## 10. Glossary

- **Health Score** — 0–100 rating of policy quality (coverage breadth, waiting periods, exclusions, limits, co-pay, claim friendliness). Bands: 0–40 Poor, 41–60 Fair, 61–80 Good, 81–100 Excellent.
- **Policy Vault** — where users store/organize policies by category and family member.
- **Claim Simulator** — evaluates a described scenario against policy terms and returns an approval probability with reasons.
- **Vector Store / Policy Chunk** — pgvector-embedded slices of a policy used for semantic retrieval.
- **RAG** — Retrieval-Augmented Generation: retrieve relevant clauses, then generate a grounded answer.
- **Background Processor / Worker** — async job runner for OCR + analysis with progress updates.
- **Coverage Gap** — an area where a client lacks adequate protection, surfaced to brokers.
- **RLS** — PostgreSQL Row-Level Security enforcing per-tenant data isolation.
- **Mock mode** — deterministic offline adapters that let the whole product run without external API keys.
- **EARS** — Easy Approach to Requirements Syntax (the WHEN/IF/WHILE/THE…SHALL patterns used in `requirements.md`).

---

*PolicyLens is an analysis and guidance tool and is not a substitute for professional insurance advice.*
