# PolicyLens — AI-Powered Insurance Intelligence Platform

> **Understand your insurance before you need it.**

PolicyLens turns dense insurance policy documents into clear, structured, actionable guidance. Upload a policy (typed PDF, scanned PDF, or photo) and get a plain‑English breakdown: coverage, exclusions, waiting periods, financial limits, co‑pay traps, hidden clauses, a 0–100 **Health Score**, an AI chat grounded in *your* document, a claim simulator, and side‑by‑side policy comparison. Brokers get a full CRM/CMS portal on top of the same engine.

This repository is a **TypeScript monorepo** (React + Vite frontend, Node.js + Express backend, shared types) backed by **Supabase** (PostgreSQL + pgvector + Auth + Storage), with a provider‑agnostic AI layer (Anthropic / OpenAI / OpenAI‑compatible like Groq) and a first‑class **mock mode** so the whole product runs end‑to‑end with **zero external keys**.

---

## Table of Contents

1. [What's built (status)](#whats-built-status)
2. [Architecture](#architecture)
3. [Project structure](#project-structure)
4. [Prerequisites](#prerequisites)
5. [Quick start](#quick-start)
6. [Environment variables](#environment-variables)
7. [Running the app](#running-the-app)
8. [Demo login & data](#demo-login--data)
9. [Mock mode vs live providers](#mock-mode-vs-live-providers)
10. [Database: migrations & seed](#database-migrations--seed)
11. [Testing](#testing)
12. [How the pipeline works](#how-the-pipeline-works)
13. [Troubleshooting](#troubleshooting)
14. [Spec & docs](#spec--docs)

---

## What's built (status)

**Everything for Phase 1 is implemented and passing** (`231` tests: 131 backend + 100 frontend; production build succeeds).

| Area | Status |
|------|--------|
| Monorepo scaffold, shared types, test tooling (Vitest + fast‑check + Supertest) | ✅ |
| DB migrations (profiles, customer + broker tables, pgvector, RLS, `match_policy_chunks`) | ✅ |
| Migration runner + idempotent demo seed | ✅ |
| Backend core (Express, config, Supabase clients, auth/RBAC/upload/rate‑limit/error middleware) | ✅ |
| AI abstraction: `AIProvider` / `EmbeddingProvider` / `OCRProvider` + factory with mock fallback | ✅ |
| Adapters: **Mock** (deterministic), **Anthropic**, **OpenAI / OpenAI‑compatible (Groq)**, **Google Vision OCR** | ✅ |
| Policy pipeline: parser (pdf‑parse + OCR routing), chunking, embeddings, analysis, **Health Score** | ✅ |
| Background worker (job queue, stage/progress, completion notification) | ✅ |
| Customer API: upload, vault, dashboard, chat (RAG), semantic search, compare, claim‑sim, family, guest preview, freemium | ✅ |
| Broker API: dashboard, clients + risk, policies/renewals/premiums, commission, claims + assistant, leads, insights, team, documents, reports/analytics | ✅ |
| Frontend foundation: dual theme, API/Supabase/React Query clients, Auth context, role routing, layouts | ✅ |
| Customer portal UI: landing, auth, guest try, upload+processing, dashboard, chat/search, vault, compare, claim‑sim, upgrade | ✅ |
| Broker portal UI: 14‑section sidebar, dashboard (KPIs/charts/insights/8 quick actions), all sub‑pages | ✅ |
| Property‑based tests (Health Score bounds/monotonicity, chunking invariants) | ✅ |

**Optional / nice‑to‑have that remain** (not required to run): end‑to‑end HTTP integration tests (`14.1–14.3`) and the freemium property test (`7.3`). The unit/component/property suites already cover this logic.

---

## Architecture

```
Browser (React SPA)
  ├─ Public (dark)      Landing / Login / Signup / Guest "Try"
  ├─ Customer portal    /app/*   (role: customer, dark navy + teal theme)
  └─ Broker portal      /broker/* (role: broker, light + navy sidebar)
        │  Bearer JWT
        ▼
Backend (Node/Express)  routes → controllers → services → repositories
  ├─ Auth & RBAC middleware (Supabase JWT)
  ├─ AI abstraction layer  (AIProvider | EmbeddingProvider | OCRProvider)
  │     └─ mock | anthropic | openai/groq | google-vision  (chosen by env)
  └─ Background worker  (Postgres-backed job queue)
        │
        ▼
Supabase  ── PostgreSQL + pgvector ── Auth ── Storage
```

**Processing pipeline:** `upload → (parse text layer | OCR) → chunk → embed (pgvector) → AI analysis + Health Score → done`, executed asynchronously by the worker with progress updates the UI polls.

**RAG (chat/search):** embed the query → cosine search `policy_chunks` (`match_policy_chunks`, similarity ≥ 0.7, top‑k) → feed the matched clauses to the LLM → grounded answer with cited sections.

See [`.kiro/specs/policy-lens/design.md`](.kiro/specs/policy-lens/design.md) for the full design (with diagrams) and [`SRS.md`](SRS.md) for the requirements spec.

---

## Project structure

```
policylens/
├── SRS.md                     # Software Requirements Specification
├── README.md                  # (this file)
├── .env.example               # documents every env var
├── package.json               # npm workspaces + root scripts
├── docker-compose.yml          # optional local Postgres + pgvector
├── shared/                    # @policylens/shared — types + Zod schemas
├── backend/                   # @policylens/backend — Express API + worker
│   ├── migrations/            # 001–007 ordered SQL (schema, RLS, functions)
│   ├── src/
│   │   ├── index.ts           # Express bootstrap
│   │   ├── config/            # typed env + config
│   │   ├── middleware/        # auth, rbac, upload, rate-limit, error
│   │   ├── routes/ controllers/ services/ repositories/
│   │   │   ├── ai/            # provider interfaces + adapters + factory
│   │   │   ├── policy/        # parser, chunking, embeddings, analysis, healthScore
│   │   │   └── broker/        # broker CRM services
│   │   ├── worker/            # background job loop
│   │   └── scripts/           # migrate.ts, seed.ts
│   └── tests/
└── frontend/                  # @policylens/frontend — React + Vite + Tailwind
    └── src/
        ├── lib/ context/ components/ layouts/ pages/{public,customer,broker}
```

---

## Prerequisites

- **Node.js ≥ 18.18** (Node 20 recommended) and npm 9+.
- A **Supabase** project (free tier is fine) — for Auth, Postgres, Storage. *Not needed for the pure test suite, which runs entirely on mocks.*
- *(Optional)* API keys for real AI/OCR: Anthropic, OpenAI (or any OpenAI‑compatible endpoint such as **Groq**), Google Vision.

---

## Quick start

```bash
# 1. Install all workspaces
npm install

# 2. Configure env (copy the example, then fill in Supabase values)
cp .env.example backend/.env      # then edit backend/.env
cp .env.example frontend/.env     # keep only the VITE_* lines for the frontend
#   (backend/.env and frontend/.env already exist in this checkout)

# 3. Apply DB schema + seed demo data (needs DATABASE_URL + Supabase keys)
npm run migrate
npm run seed

# 4. Run it (three terminals, or use the combined tips below)
npm run dev:backend     # API on http://localhost:8080
npm run worker -w @policylens/backend   # background processor
npm run dev:frontend    # app on http://localhost:5173
```

Open **http://localhost:5173**.

> Want to try it with **no Supabase and no keys at all**? Set `AI_PROVIDER=mock`, `EMBEDDING_PROVIDER=mock`, `OCR_PROVIDER=mock` — the analysis pipeline returns realistic deterministic sample data. (Auth and persistence still need Supabase; the guest **/try** preview is designed to work without an account.)

---

## Environment variables

All variables are documented in [`.env.example`](.env.example). Backend reads `backend/.env`; the frontend reads `frontend/.env` (only `VITE_*` vars are exposed to the browser).

**Backend (`backend/.env`)**

| Var | Purpose |
|-----|---------|
| `PORT` | API port (default `8080`) |
| `CLIENT_ORIGIN` | Allowed CORS origin (default `http://localhost:5173`) |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase project + keys (service‑role is **server‑only**) |
| `DATABASE_URL` | Postgres connection string — required for `npm run migrate` |
| `AI_PROVIDER` | `mock` \| `anthropic` \| `openai` |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL` | OpenAI **or** any OpenAI‑compatible endpoint (e.g. Groq: `https://api.groq.com/openai/v1`) |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Anthropic Claude |
| `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_DIM` | `openai` \| `mock` (dim `1536`) |
| `OCR_PROVIDER`, `GOOGLE_VISION_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS` | `google` \| `mock` |
| `MAX_UPLOAD_MB`, `FREE_TIER_UPLOAD_LIMIT`, `JOB_MAX_ATTEMPTS`, `JOB_CONCURRENCY_PER_USER` | Limits |

**Frontend (`frontend/.env`)**

| Var | Purpose |
|-----|---------|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Supabase browser client |
| `VITE_API_BASE_URL` | Backend base URL (default `http://localhost:8080/api`) |

> ⚠️ **Secrets:** `.env` files are git‑ignored. Never commit real keys. The service‑role key and DB password must stay server‑side only.

---

## Running the app

| Command | What it does |
|---------|--------------|
| `npm run dev:backend` | Express API with hot reload (`tsx watch`) |
| `npm run worker -w @policylens/backend` | Background worker that processes upload jobs (OCR → embed → analyze) |
| `npm run dev:frontend` | Vite dev server for the React app |
| `npm run build -w @policylens/frontend` | Production build of the frontend |
| `npm run migrate` | Apply ordered SQL migrations (idempotent) |
| `npm run seed` | Seed the demo broker + clients/policies/claims/etc. (idempotent) |
| `npm test` | Run all workspace test suites |
| `npm run typecheck` | Typecheck all workspaces |

> The **worker must be running** for uploaded policies to move from “processing” to “analyzed”. In production run it as a separate process/service.

---

## Demo login & data

After `npm run seed`, a demo broker account exists:

- **Email:** `demo.broker@policylens.dev`
- **Password:** `DemoBroker!2024`

Sign in and you land on the **Broker portal** (`/broker/dashboard`) pre‑populated with clients, policies, renewals, commissions, claims, and leads.

To use the **Customer portal**, sign up a new account (defaults to the `customer` role) and upload a policy, or use the public **/try** preview without an account.

---

## Mock mode vs live providers

The provider factory logs a banner on boot showing what's live vs mocked:

```
──────────────── PolicyLens AI providers ────────────────
  AI         LIVE  openai
  Embedding  MOCK  mock
  OCR        MOCK  mock
──────────────────────────────────────────────────────────
```

- **`mock`** — deterministic, free, offline. Returns realistic sample analysis / answers. Great for demos, CI, and development.
- **`anthropic` / `openai`** — real LLM analysis, chat, comparison, claim‑sim, insights. If the selected provider's key is **missing**, the factory automatically falls back to `mock` (and warns) so the app never hard‑fails on a missing key.
- **OpenAI‑compatible endpoints (Groq, Together, local LLMs):** set `AI_PROVIDER=openai`, `OPENAI_API_KEY=<key>`, `OPENAI_MODEL=<model>`, and `OPENAI_BASE_URL=<endpoint>`. Note these providers usually have **no embeddings endpoint**, so keep `EMBEDDING_PROVIDER=mock` (RAG still works) unless you point embeddings at a real OpenAI key.

---

## Database: migrations & seed

Migrations live in `backend/migrations/` and run in filename order; applied files are tracked in `schema_migrations` so re‑runs are safe.

```bash
npm run migrate   # requires DATABASE_URL (Supabase → Settings → Database → Connection string)
npm run seed      # requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
```

Migrations include the `vector` extension, all tables, **Row‑Level Security** on every table, and the `match_policy_chunks(policy_id, query_embedding, threshold, k)` cosine‑search function used by chat/search.

> **Supabase Storage:** create a private bucket named `policies` in the Supabase dashboard for uploaded documents. The RLS policies in `005_rls.sql` scope objects to `{user_id}/...` path prefixes.

---

## Testing

```bash
npm test                      # all workspaces
npm run test -w @policylens/backend
npm run test -w @policylens/frontend
```

- **Backend:** unit tests for services/middleware, **property‑based** tests (fast‑check) for Health Score (bounds + monotonicity) and chunking invariants, plus worker/broker logic.
- **Frontend:** component tests for the customer and broker UI, the API client, and route guards.

All tests run against **mock providers**, so no external keys or network are needed in CI.

---

## How the pipeline works

1. **Upload** — `POST /api/policies` stores the file in Supabase Storage and creates a `jobs` row.
2. **Worker** claims the job and runs: parse (pdf‑parse) or OCR (Google Vision/mock) → chunk (≤512 tokens, overlap) → embed (pgvector) → AI analysis (structured JSON, validated) → compute Health Score → mark `analyzed` + notify.
3. **Dashboard** (`GET /api/policies/:id`) shows premium, sum insured, provider, Health Score, coverage, exclusions, waiting periods, risk flags, recommendations.
4. **Chat / Search** use RAG over `policy_chunks`; answers cite the clauses they used.
5. **Compare / Claim‑Sim** run over the structured analysis.

---

## Troubleshooting

- **`EADDRINUSE :::8080`** — a backend is already running on 8080. Stop it or change `PORT`.
- **`DATABASE_URL is not set`** — required only for `npm run migrate`; copy the Supabase connection string.
- **Migrate fails with SSL** — the runner enables SSL automatically for non‑local hosts; ensure the connection string points at your Supabase pooler/host.
- **AI returns generic/partial analysis** — the LLM output failed schema validation twice; the service falls back to a partial result by design. Check the provider/model, or use `AI_PROVIDER=mock`.
- **Uploads stuck “processing”** — the **worker isn't running**. Start `npm run worker -w @policylens/backend`.
- **401 on API calls** — sign in again; sessions expire and the client redirects to `/login`.

---

## Spec & docs

- **Requirements:** [`.kiro/specs/policy-lens/requirements.md`](.kiro/specs/policy-lens/requirements.md) — 21 requirements in EARS format.
- **Design:** [`.kiro/specs/policy-lens/design.md`](.kiro/specs/policy-lens/design.md) — architecture, data model, API, diagrams.
- **Tasks:** [`.kiro/specs/policy-lens/tasks.md`](.kiro/specs/policy-lens/tasks.md) — implementation plan and status.
- **SRS:** [`SRS.md`](SRS.md) — formal software requirements specification with traceability and roadmap.

> Not a substitute for professional insurance advice.
#   p o l i c y - l e n s  
 