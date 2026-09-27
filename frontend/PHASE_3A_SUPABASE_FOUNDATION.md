# Phase 3A — Supabase / PostgreSQL Foundation

Status: **complete**. Phase 1 and Phase 2 are untouched and still authoritative
for application behaviour.

Phase 3A establishes the production backend/database foundation and preserves
the existing frontend architecture. It does **not** implement authentication
flows, AI provider calls, forecasting, the Life Event Lab, or Decision
Intelligence.

## 1. Locked architecture

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

The frontend never contains:

- Supabase service-role keys
- AI provider secret keys
- privileged database credentials

Only client-safe Supabase configuration is read by the frontend
(`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`), and every request it makes is
still filtered by Row Level Security.

## 2. What Phase 3A delivers

| Area | Deliverable |
| --- | --- |
| Database | 13 tables, UUID primary keys, `timestamptz` timestamps, real foreign keys |
| Security | RLS enabled on all 13 tables + explicit policies, `anon` fully revoked |
| Integrity | CHECK constraints, natural keys, targeted indexes |
| Automation | Reusable safe `updated_at` trigger, default-category seeding, profile bootstrap |
| Frontend boundary | Client-safe config, lazy client, row types, mapper/adapter, `SupabaseRepository` skeleton |
| Configuration | `.env.example` (names only), `.gitignore` hardened for secrets |

## 3. Database tables

| # | Table | Purpose |
| --- | --- | --- |
| 1 | `profiles` | `UserProfile`; `id` **is** `auth.users.id` |
| 2 | `accounts` | `Account`; `current_balance` is derived |
| 3 | `categories` | `Category`; product defaults + user extensions |
| 4 | `transactions` | `Transaction`; transfers are one row, two accounts |
| 5 | `recurring_transactions` | `RecurringTransaction`; deterministic recurrence |
| 6 | `budgets` | `Budget`; `spent` is derived |
| 7 | `goals` | `Goal` |
| 8 | `financial_snapshots` | `FinancialSnapshot` (append-only history) |
| 9 | `financial_insights` | `FinancialInsight` |
| 10 | `life_events` | `LifeEvent` (schema support only) |
| 11 | `scenarios` | `Scenario` (schema support only) |
| 12 | `decisions` | `Decision` (schema support only) |
| 13 | `financial_memories` | `FinancialMemory` |

Tables 8–13 exist because the domain model already declares them. Their
features land in later phases; only storage and access control are established
now.

Migration: `supabase/migrations/20260915090000_phase3a_initial_schema.sql`

## 4. Row Level Security model

- RLS is enabled on every table. With no matching policy PostgreSQL denies by
  default, so nothing is cross-tenant readable.
- Policies are scoped `to authenticated` and evaluated against
  `(select auth.uid())`, so the value is resolved once per statement.
- `profiles` is special: the primary key *is* the owner
  (`id = auth.uid()`). A user can only read and update their own profile, and
  there is deliberately **no** DELETE policy — removing a profile is part of
  deleting the auth user and cascades from `auth.users`.
- Referencing tables (`transactions`, `recurring_transactions`, `budgets`,
  `goals`) additionally check `public.owns_account(...)` /
  `public.owns_category(...)` in their `WITH CHECK` clauses, so a user can
  never point a row at another user's account or category.
- `financial_snapshots` has no UPDATE policy: a captured snapshot cannot be
  rewritten. DELETE remains available so a user can clear their own history.
- Privileges are granted explicitly: `anon` is revoked from every table,
  `authenticated` gets DML (RLS then narrows the rows), and `service_role` is
  granted only for the server-side boundary.

## 5. Constraints and indexes

CHECK constraints are kept strictly in step with the TypeScript domain model:

- account types, transaction types, category types, recurrence frequencies
- budget periods, goal statuses, user roles, pay frequencies
- supported currency codes (mirrors `src/config/currencies.ts`)
- positive monetary amounts (`amount`, `limit_amount`, `target_amount`)
- ranges: `financial_health_score` 0–100, `confidence` 0–1,
  `savings_rate` 0–100, `affordability_score` 0–100
- transfer semantics: a transfer needs a distinct `to_account_id` and no
  category; income/expense need a category and no `to_account_id`
- natural keys: `categories(user_id, type, lower(name))` case-insensitively,
  `budgets(user_id, category_id, period, start_date)`

Indexes cover `user_id` on every user-owned table plus the query shapes the
Financial Core and the intelligence layer actually use: `transactions(account_id)`,
`transactions(date)`, `transactions(category_id)`,
`recurring_transactions(next_occurrence_at)`, `budgets(category_id)`,
`goals(status)`, `financial_snapshots(user_id, captured_at)` and
`financial_insights(user_id, created_at)`.

## 6. Derived values — never double-applied

| Value | Rule |
| --- | --- |
| `accounts.current_balance` | Re-derived from `initial_balance` + all transaction effects (`deriveAccountBalances`) |
| `budgets.spent` | Re-derived from real expense transactions in the period (`withDerivedBudgetSpending`) |
| `recurring_transactions.next_occurrence_at` | Advances only through a single idempotent materialisation path; a page render never creates transactions |

`SupabaseRepository.load()` re-derives accounts and budgets instead of trusting
the stored numbers, exactly like the local path, so an effect can never be
applied twice.

## 7. Frontend boundary

```text
src/services/supabase/
  config.ts              client-safe config + service-role key guard
  client.ts              lazy Supabase client (null when unconfigured)
  database.types.ts      snake_case row types + insert payloads
  mappers.ts             snake_case <-> camelCase adapter (no type changes)
  supabaseRepository.ts  FinancialRepository implementation (skeleton)
```

- `mappers.ts` preserves every application-facing type in
  `src/types/financial.ts`. It only translates names.
- `config.ts` refuses a key that decodes to the `service_role` role instead of
  shipping it to the browser.
- `SupabaseRepository` implements the existing `FinancialRepository` interface.
  `LocalStorageRepository` is untouched and remains what the app uses today.

### Domain-compatibility decisions

- **`profiles.email` does not exist.** Supabase Auth owns the authoritative
  authentication email; `toAppProfile(row, email)` takes the email from
  `auth.users`, never from `profiles`.
- **Category identity is the database uuid**, uniform with accounts, goals, and
  every other entity, so renaming a category keeps history pointing at it.
  Compatibility with the central configuration is structural: the same default
  names and types are seeded from `src/config/categories.ts`, and the natural
  key `(user_id, type, name)` lets an upsert adopt a Phase 2 slug id without
  creating a duplicate.

## 8. Environment variables

Copy `.env.example` to `.env.local` (git-ignored) and fill in names only from
the Supabase dashboard:

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Server-only values (`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`,
`AI_PROVIDER_API_KEY`) are listed in `.env.example` as comments and belong to
the FinWise backend secrets manager — never to a `VITE_` variable.

## 9. Applying the migration

The migration is plain PostgreSQL and is safe to run as a Supabase migration.

```bash
# linked CLI project
supabase db push

# or, locally
supabase migration up
```

Paste the same file into the Supabase SQL editor if the CLI is not set up.

What it installs automatically:

- every table, constraint, and index
- RLS plus all policies and privileges
- the `set_updated_at()` trigger function, attached to `profiles`, `accounts`,
  `transactions`, and `recurring_transactions`
- `seed_default_categories(uuid)` — idempotent default-category seeding
- `handle_new_user()` + the `on_auth_user_created` trigger on `auth.users`,
  which creates the profile row and the default categories for a new user
  (backend plumbing only — Supabase Auth still owns authentication)

## 10. Deliberately NOT in Phase 3A

- AI provider calls, prompts, or secrets (Phase 4)
- Forecasting, Life Event Lab, Decision Intelligence (Phase 5)
- The authentication UI flow (Phase 3B)
- Swapping `FinancialDataProvider` from `LocalStorageRepository` to
  `SupabaseRepository` (Phase 3B/3C)
- Backend/server functions and edge functions
- Migrating existing browser data into PostgreSQL

Nothing in Phase 3A fabricates data, and no dashboard number changes.

## 11. Remaining setup requiring a manual Supabase action

1. **Create or link a Supabase project** and enable the `auth.users` table
   (Supabase Auth is on by default).
2. **Apply the migration** (see section 9). It must run with a role that may
   create the trigger on `auth.users` — `supabase db push` or the dashboard SQL
   editor both qualify; a plain anon-key client does not.
3. **Populate `.env.local`** with `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` from Project Settings → API. Never add the
   service-role key to a `VITE_` variable.
4. **Confirm RLS is on** in the dashboard (Table Editor should show RLS enabled
   for all 13 tables) and that `anon` has no grants on them.
5. **Decide the email-confirmation / redirect settings** for Auth when Phase 3B
   adds the sign-in experience.

Phase 3A stops here. Phase 3B/3C, Phase 4, and Phase 5 are not started.

> **Update — Phase 3B is complete.** The two items listed under section 10 as
> Phase 3B work have since been delivered: the authentication UI flow
> (`AuthProvider` + `RequireAuth` + the existing `AuthPage`) and the
> `FinancialDataProvider` repository swap, which now selects
> `SupabaseRepository` for authenticated users. Phase 3A itself was not
> modified; this note only records that its deferred items are now done.
> See `PHASE_3B_PERSISTENCE_AUTH.md`.