# FinWise AI

FinWise AI is a personal financial intelligence system designed to help users understand their financial life, model future decisions, and make high-confidence spending choices.

## Tech stack

- React
- TypeScript
- Vite
- Tailwind CSS
- React Router
- Lucide icons
- Supabase (`@supabase/supabase-js`) — authentication, PostgreSQL persistence, row level security
- ESLint

## Phase 1 foundation

This repository contains the foundation for the FinWise product vision, including:

- landing page
- auth page shell
- application shell and responsive navigation
- overview dashboard
- accounts, transactions, budget, goals, analytics, future lab, AI assistant, settings
- privacy center structure
- typed domain model and AI/provider interfaces
- future-ready intelligence layer and currency architecture

## Data and authentication (Phase 3)

The UI talks to data only through the `FinancialRepository` interface. Two
implementations exist:

- `SupabaseRepository` — production persistence for authenticated users, backed
  by Supabase Auth, PostgreSQL, and row level security. Every row is scoped to
  `auth.uid()` by RLS, and the frontend uses the browser-safe publishable key
  only.
- `LocalStorageRepository` — the deliberate fallback used when Supabase is not
  configured in the environment (no user can be signed in there).

Authentication is centralised in `AuthProvider` + `RequireAuth`: session
restoration on refresh, auth state changes, sign-up/sign-in/sign-out, and route
protection for the authenticated application shell.

Configuration lives in `.env.local` (git-ignored). Only two client-safe variables
are used: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Never place the
service-role key, a database password, or an AI provider secret in a `VITE_`
variable. See `.env.example` and `PHASE_3B_PERSISTENCE_AUTH.md` for details.

## Verification

```bash
node verify_phase3a.mjs        # schema, types, migration cross-checks
node verify_phase3b.mjs        # auth + persistence integration checks (static)
node verify_live_phase3a.mjs   # live Supabase config, auth health, anon lockdown
npm run build
npm run lint
```

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

