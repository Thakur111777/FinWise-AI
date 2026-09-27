# FinWise AI Project Architecture

## 1. Technology stack

- React + TypeScript
- Vite for development and build tooling
- Tailwind CSS for styling
- React Router for app-level navigation
- Lucide icons for UI polish
- ESLint for static verification
- Supabase JS client for the client-safe backend boundary
- Backend: Supabase Auth + PostgreSQL with Row Level Security

## 2. Folder structure

```text
src/
  ai/
  components/
    layout/
    ui/
  config/
  features/
  hooks/
  intelligence/
  lib/
  pages/
  services/
    financial/
    supabase/
  types/
  utils/

supabase/
  migrations/

.env.example
```

`src/services/supabase/` is the only place the frontend touches Supabase, and it
holds only client-safe (public) configuration. `supabase/migrations/` owns the
database schema, Row Level Security policies, and triggers.

## 3. Architecture decisions

The app intentionally separates user interface, business logic, and future AI/back-end integration. The UI shows pages and shell structure, but the financial calculations are isolated behind deterministic logic instead of being embedded in components.

The app is built around progressive disclosure: simple insights first, then deeper explanation and AI reasoning later.

## 4. Database architecture (established in Phase 3A)

The locked backend architecture is:

```text
React Frontend
  ↓
FinWise Backend / secure server boundary
  ↓
Supabase
├── Auth
└── PostgreSQL
  ↓
Row Level Security
```

- PostgreSQL data layer via Supabase with UUID primary keys, `timestamptz`
  timestamps, and real foreign keys
- relational tables for profiles, accounts, categories, transactions,
  recurring transactions, budgets, and goals
- intelligence tables for snapshots, insights, life events, scenarios,
  decisions, and financial memories
- Row Level Security on every user-owned table, with `auth.uid()` ownership
- a clean snake_case (database) to camelCase (application) mapper boundary in
  `src/services/supabase/mappers.ts`; the existing domain types are unchanged
- the frontend holds only the public anon key — never service-role keys,
  database credentials, or AI provider secrets

Full detail: `PHASE_3A_SUPABASE_FOUNDATION.md`.

## 5. AI provider architecture

The frontend must never contain secret keys. AI access should flow through:

React Frontend
  ↓
FinWise Backend
  ↓
AI Context Builder
  ↓
Provider Adapter
  ↓
AI Provider / Model

The provider adapter is intentionally abstracted so Gemini, OpenAI, Claude, or other compatible providers can be swapped without rewriting the app.

In Phase 3C this boundary became concrete: `src/ai/copilotService.ts` is the only browser call site, and it invokes the `finwise-copilot` Supabase Edge Function (`supabase/functions/finwise-copilot/index.ts`), which builds financial context server-side under the caller's RLS scope and calls the configured provider (`AI_PROVIDER` / `AI_MODEL` / `AI_PROVIDER_API_KEY` secrets). Full detail: `PHASE_3C_COPILOT.md`.

## 6. Financial intelligence architecture

Deterministic logic belongs in the intelligence layer. This will eventually host:

- Safe-to-Spend calculation
- Financial Health Score
- budget forecasts
- goal progress math
- cash-flow calculations
- forecasting and scenarios
- anomaly detection
- decision analysis

AI should explain financial calculations, not decide the numbers.

## 7. Currency architecture

The domain model uses `currencyCode` rather than only a symbol. Supported currencies include:

- INR
- USD
- EUR
- GBP
- JPY
- CAD
- AUD

The architecture is future-ready for multi-currency accounts and user-selected primary currency.

## 8. Security principles

- no secret keys in frontend code
- backend-mediated AI calls only
- deterministic logic separate from generative AI
- privacy-first data model planning
- consent-aware and role-aware access patterns
- future secure server functions and validation

## 9. Development phases

- Phase 1: foundation, shell, routes, architecture, deterministic analysis layer
- Phase 2: data model and middleware integration
- Phase 3: authentication, secure backend, persistence
  - Phase 3A: **complete** — Supabase/PostgreSQL schema, RLS, client-safe configuration boundary, mapper/adapter, repository skeleton
  - Phase 3B: **complete** — Supabase authentication/session layer, route protection, profile-bootstrap reuse, `SupabaseRepository` wired as the production persistence layer for authenticated users (RLS-enforced ownership); the Accounts screen is exposed at `/accounts` in the sidebar and mobile navigation
  - Phase 3C: **complete** — FinWise Copilot: server-side context builder, provider abstraction, and the `finwise-copilot` Supabase Edge Function as the only AI path (browser sends a question + bounded history and receives an answer; secrets stay in Edge Function env)
- Phase 4: AI context builder and provider abstraction
  - Delivered by Phase 3C (see `PHASE_3C_COPILOT.md`); future provider/UI expansion continues here
- Phase 5: forecasting, life-event simulation, decision intelligence, adaptive recommendations
