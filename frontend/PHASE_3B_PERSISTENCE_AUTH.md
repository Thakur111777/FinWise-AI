# Phase 3B — Production Persistence & Authentication Integration

Phase 3B connects the locked Phase 1–2 application to the Phase 3A Supabase
schema and to real Supabase Auth. No UI was redesigned, no domain model changed,
and no second data abstraction was introduced.

## 1. Final architecture

```
React UI (Phase 1–2 pages, unchanged)
   ↓
application / service / domain layer (Phase 2 services, unchanged)
   ↓
FinancialRepository interface          src/services/financial/repository.ts
   ↓
SupabaseRepository                     src/services/supabase/supabaseRepository.ts
   ↓
Supabase client (anon key only)        src/services/supabase/client.ts
   ↓
Supabase Auth + PostgreSQL + RLS
```

`FinancialRepository` remains the application's only data boundary. No page,
hook, or component calls `supabase.from(...)`.

## 2. Authentication layer

Files added by Phase 3B:

| File | Responsibility |
| --- | --- |
| `src/features/auth/authContextCore.ts` | `AuthStatus`, `AuthUser`, `SignUpOutcome`, `AuthContext` (split out so the react-refresh components-only lint rule stays clean — same pattern as `financialDataContextCore.ts`) |
| `src/features/auth/authContext.tsx` | `AuthProvider`: session restore, auth-state subscription, sign-in/sign-up/sign-out, error translation |
| `src/features/auth/useAuth.ts` | `useAuth()` accessor that fails loudly outside the provider |
| `src/features/auth/RequireAuth.tsx` | Route guard and initialising screen |

Behaviour:

- **Session restoration** — `client.auth.getSession()` runs once on mount, so a
  page refresh on a protected route keeps the user signed in.
- **Auth state changes** — `client.auth.onAuthStateChange(...)` keeps the store in
  sync for sign-in, sign-out, token refresh, and user switch. The callback only
  sets React state (calling further client methods inside it can deadlock
  supabase-js's internal lock). The subscription is removed on unmount.
- **Loading state** — `status: 'initializing' | 'authenticated' | 'unauthenticated'`
  is exposed to the app; routes wait for it before making any redirect decision.
- **Sign-up** — `client.auth.signUp({ email, password, options: { data: { name } } })`.
  When Supabase returns no session, the page honestly reports that email
  confirmation is required instead of pretending the user is signed in.
- **Sign-in** — `client.auth.signInWithPassword(...)`; the returned session is
  applied immediately so route protection sees `authenticated` before navigation.
- **Sign-out** — `client.auth.signOut()`; local state is cleared immediately and
  the `SIGNED_OUT` event also arrives.
- **Errors** — mapped to actionable messages (wrong credentials, unconfirmed
  email, duplicate account, weak password, rate limiting) and rendered inline.
- **Centralisation** — `supabase.auth` is never called outside the auth layer and
  the Supabase service folder. Passwords are only ever passed to Supabase Auth;
  there is no custom password system and nothing is stored client-side.

## 3. Route protection

`src/App.tsx` wraps the authenticated `<AppShell />` route in `<RequireAuth>`.
Public routes (`/`, `/login`, `/signup`) stay public.

- **initialising** → neutral loading screen, **no redirect** (this is what
  prevents a refresh from bouncing a signed-in user to `/login`).
- **unauthenticated** → `<Navigate to="/login" replace state={{ from }} />`; the
  auth page sends the user back to the page they originally requested.
- **authenticated** → renders the app shell. A signed-in user visiting
  `/login` or `/signup` is redirected to their target, so there are no redirect
  loops.
- **local mode** (Supabase unconfigured) → `RequireAuth` renders children
  directly, preserving the deliberate Phase 2 fallback.

## 4. Profile bootstrap

Bootstrap is **not** duplicated in frontend code. The Phase 3A migration already
installs `public.handle_new_user()` as an `AFTER INSERT` trigger on `auth.users`,
which creates the `profiles` row and calls `public.seed_default_categories()`
(idempotent). Phase 3B therefore only:

- sends the optional display name as sign-up metadata, which the trigger reads
  from `raw_user_meta_data ->> 'name'`;
- upserts the profile through the repository when the user edits Settings;
- takes the authoritative email from Supabase Auth (`auth.users.email`) — it is
  deliberately not stored in `profiles`;
- forces the upsert id to the session user id, so a profile can only ever be
  written for the signed-in user.

`profiles` has no DELETE policy: deleting a profile is part of deleting the auth
user, which cascades from `auth.users`.

## 5. Repository selection (one source of truth)

`FinancialDataProvider` (`src/features/dashboard/financialDataContext.tsx`) picks
the repository once, per persistence identity:

| Environment | Session | Repository |
| --- | --- | --- |
| Supabase configured | signed in | `SupabaseRepository` (production persistence) |
| Supabase configured | signed out | none — honest empty state, protected routes redirect |
| Supabase unconfigured | impossible | `LocalStorageRepository` (deliberate fallback) |

There is no dual persistence: for an authenticated user, Supabase is the only
source of truth. `LocalStorageRepository` is reachable only when Supabase is
unconfigured, where no user can be signed in at all.

The store is keyed by persistence identity (`local` / `signed-out` / `user.id`),
so sign-in, sign-out, and account switches remount it with clean state and a
signed-out visitor can never observe the previous user's data.

## 6. SupabaseRepository

`SupabaseRepository implements FinancialRepository` — the existing interface, no
competing abstraction. It implements exactly the methods the interface declares
(`load`, `saveProfile`, `saveAccounts`, `saveCategories`, `saveTransactions`,
`saveRecurringTransactions`, `saveBudgets`, `saveGoals`).

- **Loading** — one parallel read per collection for the signed-in user, ordered
  deterministically, then mapped into the domain model. Derived money is
  re-derived, never trusted: `accounts.current_balance` via
  `deriveAccountBalances()` and `budgets.spent` via `withDerivedBudgetSpending()`.
  A missing session returns an honest empty state (RLS would return nothing).
- **Writing** — upserts keyed on the row id (categories use the natural key
  `user_id,type,name` so a Phase 2 slug id can adopt a trigger-seeded default
  without duplicating it). Accounts and categories are archived/hidden by the
  Financial Core, never deleted, matching their `ON DELETE RESTRICT` foreign
  keys.
- **Deletion reconciliation** — transactions, recurring transactions, and goals
  prune rows no longer present, guarded twice: an empty collection is never
  pruned, and pruning is skipped unless every id is a real uuid (Phase 2 mints
  `txn-<uuid>` style ids, whose database ids are unknown).
- **Errors** — every PostgREST error is turned into a thrown `Error` with an
  explicit message; nothing fails silently.

Phase 3A tables for `financial_snapshots`, `financial_insights`, `life_events`,
`scenarios`, `decisions`, and `financial_memories` remain schema-only: their
features land in later phases and `FinancialRepository` declares no operations
for them yet, so Phase 3B adds none.

## 7. Mapping boundary

`src/services/supabase/mappers.ts` (Phase 3A) is the only place snake_case
database columns meet the camelCase domain model:

```
TypeScript / domain model   (camelCase, src/types/financial.ts — unchanged)
        ↕  mappers.ts
PostgreSQL / PostgREST       (snake_case)
```

Snake_case field names never leak into components, and no UI file imports a
Supabase row type. Money values pass through `roundMoney()` before being written,
so PostgreSQL never receives a drifted float; blank text is normalised to `null`
on the way in and `undefined` on the way out. `isUuid()` guards prefixed Phase 2
ids from being sent as uuid primary keys. `UserProfile.email` comes from Supabase
Auth, never from `profiles`.

## 8. Ownership and RLS

- The repository never accepts a user id from the UI: `getUserId`/`getEmail` are
  supplied by `FinancialDataProvider` from the resolved session, and
  `requireUserId()` throws if there is no session.
- Every read filters on `user_id`; every write sets `user_id` from the session;
  every delete is constrained by `.eq('user_id', userId)`.
- RLS remains the authoritative security boundary. No policy was weakened, no
  table was made publicly readable, and RLS was not disabled. Frontend checks
  exist only for UX (redirecting signed-out visitors), never as the security
  boundary.
- `auth.users` is never queried from the frontend.
- The live verifier confirms `anon` is still denied on all 13 tables.

## 9. Loading, errors, and refresh

- The first hydration is a single `repository.load()` per persistence identity; a
  failed load falls back to an honest empty state and surfaces the message in the
  app-shell banner rather than crashing or spinning forever.
- `isHydrated` and `lastError`/`clearLastError` are exposed on the existing
  `FinancialDataContextValue`; `AppShell` renders the dismissible banner.
- Every mutation goes through `withErrorReporting`, so an error is always
  surfaced and also rethrown for the calling form's inline display.
- After a mutation in Supabase mode the store re-reads the authoritative
  collections (`refreshFromRepository`, latest-wins guarded by a sequence
  counter). This is what adopts database-assigned uuids back into state, so later
  foreign-key writes and the RLS `owns_account`/`owns_category` checks always
  pass — and it avoids a full-page reload.
- No new state-management library was added.

## 10. Security posture

- Only the browser-safe publishable/anon key is referenced; `config.ts` explicitly
  refuses a service-role key rather than shipping it.
- No service-role key, database password, `postgres://` URL, or AI provider secret
  exists in frontend source or in any `VITE_` variable.
- `.env.example` declares exactly the two client-safe variables; `.env.local` is
  covered by `.gitignore` (the template stays tracked).
- The UI cannot bypass the repository: `supabase.from(...)` appears only inside
  `src/services/supabase`.

## 11. Verification

Run from the project root:

```
node verify_phase3a.mjs        # Phase 3A schema/types/migration cross-checks
node verify_phase3b.mjs        # Phase 3B auth + persistence integration checks
node verify_live_phase3a.mjs   # live Supabase: config, auth health, anon lockdown
npm run build                  # tsc -b && vite build
npm run lint                   # eslint .
```

`verify_phase3b.mjs` is static (no network, no credentials) and covers the auth
layer, route protection, auth UI, repository selection, the repository boundary,
auth centralisation, the security scan, the Accounts surface, and account UX
consolidation.

**Accounts surface (`[8]`):** the Financial Core and `AccountsPage` already
existed, but the screen was unreachable because `appRoutes` had no `accounts`
entry and `App.tsx` declared no `/accounts` route — so Overview/Transactions told
signed-in users to "create an account" with no way to get there. The fix is
integration only: a `{ key: 'accounts', path: '/accounts' }` route entry (which
both `Sidebar` and `MobileNav` render from), a `WalletCards` icon, the
`<Route path="/accounts">` inside the protected `AppShell`, and deep links from
the two empty states. No new page, no new repository method, no new data path.

**Account UX consolidation (`[9]`):** Accounts is the single canonical
account-management surface. The Dashboard keeps its read-only "Account balances"
summary card and Transactions keeps its empty state; both only *link* to
`/accounts`. Consequently `AccountsPage.tsx` is the only page that calls
`createAccount`/`updateAccount`/`archiveAccount`/`unarchiveAccount`, and the
account form (`AccountFormModal`) exists in exactly one place — so no second
account-management implementation can drift out of sync. Both navigation
components render from the single `appRoutes` configuration, so adding or
renaming an entry cannot leave desktop and mobile navigation disagreeing.

**Manual/external limits on automated end-to-end auth testing:** the project has
no browser-automation dependency (`package.json` contains no test runner,
Playwright, or Puppeteer), so there is no automated browser harness to drive a
real sign-in. A complete live sign-in → CRUD → RLS-ownership test would require a
confirmed test account (Supabase email confirmation) and either such a harness or
its credentials, which cannot be obtained programmatically. Nothing was weakened
to work around this: email confirmation stays on, RLS stays on, and the live
verifier instead proves the client boundary and the deny-by-default posture.

## 12. Deliberately NOT in Phase 3B

- AI Copilot / provider calls, prompts, or secrets (Phase 4)
- Forecasting, Life Event Lab, Decision Intelligence (Phase 5)
- Dashboard redesign or new financial intelligence
- Backend/server or edge functions
- Migrating pre-existing browser data into PostgreSQL
- Any Phase 3A change: the applied migration was not modified

