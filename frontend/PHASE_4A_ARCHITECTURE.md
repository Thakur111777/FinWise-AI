# Phase 4A — Financial Intelligence Platform: Architecture + Scope Lock

Status: **architecture ready — no implementation performed.** Phase 3 remains
locked. This document is the authoritative Phase 4 scope lock: it defines what
Phase 4 may build, on top of which Phase 3 primitives, and in which order.

## 1. Phase 4 objective

Phase 4 = **Financial Intelligence Platform**: make FinWise understand the
user's financial behaviour and state at a deeper level, *on top of* the verified
Phase 3 infrastructure.

Phase 4 capabilities (only these five):

1. Financial Digital Twin
2. Advanced Financial Analytics
3. Hidden Spending Detector
4. Smart Financial Alerts
5. Financial Memory

Explicit non-goals (later phases): conversational AI expansion, natural-language
transaction entry, Copilot redesign, future cash-flow prediction, Financial Time
Machine, Decision Intelligence, Life Event Lab, predictive modelling, and any
privacy/production hardening beyond what already exists.

## 2. Architectural principle (unchanged, non-negotiable)

```text
Persisted Financial Data
        ↓
Phase 2/3 Financial Services      (src/services/financial/*)
        ↓
Deterministic Financial Intelligence   (src/intelligence/*)
        ↓
Phase 4 Intelligence Layer        (src/intelligence/* — new modules)
        ↓
UI / dashboards / insights / alerts / memory
```

Financial numbers stay deterministic. AI (Gemini / Edge Function) never
calculates balances, income, expenses, transfers, savings rate, Safe-to-Spend,
budget spending, goal progress, or health metrics. AI must not become the source
of truth for any financial figure.

## 3. What already exists (verified by inspection)

### ALREADY IMPLEMENTED (reuse — do not recreate)

| Area | Location | Notes |
| --- | --- | --- |
| Deterministic engine | `src/intelligence/finance.ts` | `safeToSpend`, `buildSafeToSpendBreakdown`, `computeMonthlyFlow`, `computeNetWorthBreakdown`, `bufferMonths`, `calculateFinancialHealthScore`, `projectionSummary`, `goalProgress`, `aggregateGoalProgress`, `computeDashboardMetrics`, `classifySpending`, `monthlyCommittedBills`, `monthlyBudgetCommitments`, `currentMonthIncome/Expenses` |
| Money correctness | `src/lib/money.ts` | integer minor units; every engine amount is quantized |
| Currency / dates | `src/lib/currency.ts`, `src/lib/date.ts` | currency codes, local-month helpers |
| Domain model | `src/types/financial.ts` | already declares `FinancialSnapshot`, `FinancialInsight`, `FinancialMemory`, `DashboardMetrics`, `DashboardDataInput` |
| Financial services | `src/services/financial/*` | account/budget/category/goal/profile/recurring/transaction services, validation, state, selectors, result |
| Persistence boundary | `src/services/financial/repository.ts` | `FinancialRepository` + `StoredFinancialState` + `createEmptyStoredState` |
| Implementations | `localStorageRepository.ts`, `src/services/supabase/supabaseRepository.ts` | local fallback + production (RLS-scoped, session identity) |
| Data store | `src/features/dashboard/financialDataContext.tsx` | hydration, actions, remount per authenticated identity |
| Metrics bridge | `useDashboardMetrics.ts` | single deterministic derivation per state change |
| Auth | `src/features/auth/*` | session restore, `RequireAuth`, route protection |
| Copilot | `src/ai/*` + `supabase/functions/finwise-copilot/index.ts` (+ `scope.ts`) | read-only, JWT-scoped, secrets server-side |
| DB schema + RLS | `supabase/migrations/20260915090000_phase3a_initial_schema.sql` | 13 tables, RLS, ownership helpers |

### Database structures already designed *for* Phase 4

These tables exist with full RLS and no application write path yet:

| Table | Shape | Phase 4 role |
| --- | --- | --- |
| `financial_snapshots` | `captured_at, net_worth, cash_flow, safe_to_spend, financial_health_score, income, expenses, savings_rate, debt, currency_code` + range/currency CHECKs; policies **select, insert, delete** (no update — append-only) | Digital Twin point-in-time memory |
| `financial_insights` | `type in ('alert','optimization','forecast','risk','milestone')`, `title, summary, details, confidence 0..1, category, created_at`; policies **select, insert, update, delete** | Smart Alerts + analytics insights |
| `financial_memories` | `theme in ('spending','goal','risk','habit','milestone')`, `title, description, context jsonb (object), created_at`; policies select/insert/update/delete | Financial Memory |
| `life_events`, `scenarios`, `decisions` | schema-only | **out of Phase 4 scope** (later phases) |

**Conclusion: Phase 4 requires no database migration and no RLS change.**

### PARTIALLY IMPLEMENTED

- `classifySpending()` — deterministic category-spend reducer, exported, **but
  consumed by nothing**. It is the seed primitive for analytics + hidden spending.
- `AnalyticsPage` — real but minimal: income vs spending, savings rate, buffer
  coverage. Fed by `metrics.monthly` / `metrics.bufferMonths` only.
- Financial health score, Safe-to-Spend, net worth, monthly flow — fully
  implemented, single-period (current month / 90 days). No historical series.
- Phase 4 DB tables — schema + RLS complete; **no repository operation, no writer**.
- Copilot already reads the latest snapshot + latest 8 insights — so a Phase 4
  snapshot writer improves Copilot context with zero Copilot changes.

### NOT IMPLEMENTED

Digital Twin representation/service; period + series primitives; trends and
month-over-month analytics; category/recurring/savings/budget utilisation
patterns; spending concentration; transaction frequency; hidden-spending
detectors; alert rule engine; alert dedup/dismissal; insight writer; snapshot
capture policy; financial memory writer/reader; all Phase 4 UI surfaces.

### REQUIRES EXTENSION

- A new, additive intelligence persistence interface (see §7) — `FinancialRepository`
  itself is **not** modified, keeping Phase 3 locked.
- New pure modules under `src/intelligence/` (twin, periods, analytics, hidden
  spending, alerts, memory).
- One new provider/hook to derive intelligence once and expose it to pages.

### Classified summary

| Capability | Status |
| --- | --- |
| Deterministic engine (health, Safe-to-Spend, net worth, flow) | ALREADY IMPLEMENTED |
| Snapshot / insight / memory table + RLS | ALREADY IMPLEMENTED (schema only) |
| Category spend classification | PARTIALLY IMPLEMENTED (unused primitive) |
| Analytics UI | PARTIALLY IMPLEMENTED (single-period, 3 cards) |
| Digital Twin | NOT IMPLEMENTED |
| Advanced analytics (trends, MoM, series) | NOT IMPLEMENTED |
| Hidden spending detector | NOT IMPLEMENTED |
| Smart alerts + dedup/dismissal | NOT IMPLEMENTED |
| Financial memory writer/reader | NOT IMPLEMENTED |
| Intelligence persistence (repo ops) | REQUIRES EXTENSION |
| Derive-once provider for intelligence | REQUIRES EXTENSION |

## 4. Phase 4 architecture (final)

```text
FinancialRepository (Phase 3 — UNCHANGED, still the financial truth boundary)
        ↓
Deterministic Financial Intelligence (src/intelligence/finance.ts — UNCHANGED)
        +
Phase 4 deterministic primitives (new, pure, no I/O):
  src/intelligence/periods.ts        period keys, month bucketing, windows
  src/intelligence/series.ts         income/expense/category/balance series
  src/intelligence/twin.ts           buildFinancialTwin(state, metrics)
  src/intelligence/analytics.ts      trends, MoM deltas, utilisation, concentration
  src/intelligence/hiddenSpending.ts detectors + evidence
  src/intelligence/alerts.ts         deterministic rule engine + fingerprints
  src/intelligence/memory.ts         memory candidate triggers + idempotency keys
        ↓
Phase 4 services (orchestration only, no math):
  src/services/financial/intelligence/  (twinService, analyticsService,
                                         hiddenSpendingService, alertService,
                                         memoryService)
        ↓
FinancialIntelligenceRepository (NEW additive interface, sibling of
FinancialRepository — Phase 3 interface untouched)
  SupabaseIntelligenceRepository   (production; caller's JWT + anon key, RLS)
  LocalStorageIntelligenceRepository (fallback, unconfigured environment)
        ↓
FinancialIntelligenceProvider (new) — derives ONCE per financial state change
        ↓
UI: OverviewPage (alerts + twin headline), AnalyticsPage (analytics + hidden
spending + memory timeline), FinancialTwinPage (new, progressive disclosure)
```

Rules: every calculation lives in exactly one `src/intelligence/*` module; no
service or component recomputes a metric; new services orchestrate and persist
but never do math; AI is not in this pipeline at all.

## 5. Data flow

1. `FinancialDataProvider` (existing) hydrates `StoredFinancialState` from the
   repository and exposes actions.
2. `computeDashboardMetrics(state)` (existing engine) produces the authoritative
   headline metrics.
3. `buildFinancialTwin(state, metrics)` (new, pure) produces the derived twin.
4. Analytics / hidden spending / alerts / memory candidates are derived from the
   same `state` + `twin` in one pass — no duplicate reducers.
5. Persistence side-effects run only from services, only after load:
   - `FinancialTwinService.captureSnapshot()` → at most one snapshot per period
     key (default: per local day, plus on material change).
   - `AlertService.syncAlerts()` → upsert-by-fingerprint into `financial_insights`.
   - `MemoryService.recordCandidates()` → append-once per idempotency key into
     `financial_memories`.
6. History for trends is loaded once at hydration (bounded, e.g. latest 12
   snapshots + latest 50 memories) in parallel with the existing collection
   loads. No per-component queries.

Reading vs writing: derivation is pure and side-effect free; persistence is
explicit, bounded, and idempotent (fingerprint / period key / idempotency key).

## 6. Financial Digital Twin design

Two layers, deliberately separated to avoid duplicating financial truth.

**A. Derived twin (never stored, recomputed — the live representation)**

```ts
interface FinancialTwin {
  state: {
    identity: { profile; currencyCode; payFrequency; expectedMonthlyIncome };
    accounts: { total; active; byType; balanceByCurrency; cash; investments; debt };
    income: MonthlyFlow | null;
    expenses: MonthlyFlow | null;
    recurringCommitments: { monthlyTotal; items };
    budgets: { count; committed; byCategory };
    goals: { activeCount; aggregateProgress; items };
  };
  behavior: {
    spendingByCategory: CategorySpend[];   // reuses classifySpending semantics
    incomePattern: PeriodSeries;           // months with income, cadence
    recurringPattern: { monthlyEquivalent; concentration };
    categoryBehavior: CategoryTrend[];     // direction + magnitude per period
    savingsBehavior: { rate; series };
  };
  health: {
    cashPosition: NetWorthBreakdown | null;
    bufferMonths: number | null;
    safeToSpend: SafeToSpendBreakdown | null;
    financialHealthScore: number | null;
    budgetUtilization: BudgetUtilization[];
    goalProgress: GoalProgressInfo;
  };
  relationships: {
    accountTransactionLinks: { accountId; transactionCount; inflow; outflow }[];
    categoryTransactionLinks: { categoryId; transactionCount; amount }[];
    budgetSpendingLinks: { budgetId; categoryId; limit; spent; utilization }[];
    goalSavingsLinks: { goalId; progress; contributionConsistency }[];
    recurringCashFlowLinks: { recurringId; shareOfIncome; shareOfExpenses }[];
  };
  evidence: TwinEvidence;        // period, source collections, derivedAt
  insufficientData: string[];    // parts that cannot be derived yet
}
```

**B. Persisted twin memory (`financial_snapshots`)**

The existing table is already the twin's time series: health score,
Safe-to-Spend, net worth, cash flow, income, expenses, savings rate, debt. It is
append-only (no UPDATE policy), matching a twin that records but never rewrites
history. Capture policy (4B): one snapshot per period key; recapture only when a
deterministic material-change predicate fires (documented threshold on health
score / Safe-to-Spend / net worth). Values come only from
`computeDashboardMetrics()`.

## 7. Intelligence persistence extension (only Phase 3 boundary addition)

New file: `src/services/financial/intelligenceRepository.ts`

```ts
export interface FinancialIntelligenceRepository {
  loadSnapshots(limit: number): Promise<FinancialSnapshot[]>;
  saveSnapshot(snapshot: NewFinancialSnapshot): Promise<void>;
  loadInsights(limit: number): Promise<FinancialInsight[]>;
  saveInsight(insight: NewFinancialInsight): Promise<void>;
  updateInsight(id: string, patch: Partial<NewFinancialInsight>): Promise<void>;
  deleteInsight(id: string): Promise<void>;
  loadMemories(limit: number): Promise<FinancialMemory[]>;
  saveMemory(memory: NewFinancialMemory): Promise<void>;
}
```

- Additive and separate: `FinancialRepository` and its two existing
  implementations are **not modified**, so Phase 3 stays locked.
- `SupabaseIntelligenceRepository` uses the same browser-safe client
  (`getSupabaseClient()`), resolves identity from the verified session only, and
  never carries a service-role key. Every call stays RLS-scoped.
- `LocalStorageIntelligenceRepository` preserves the deliberate
  unconfigured-environment fallback, consistent with the existing architecture.
- Insert shapes (`NewFinancialSnapshot` = snapshot without `id`/`capturedAt`, and
  the insight/memory insert shapes) are declared alongside the new services.
  Where a shared type is unavoidable, any change to `src/types/financial.ts` must
  be strictly additive and reported in the 4B report.
- No migration, no new table, no RLS change: `financial_snapshots`,
  `financial_insights`, `financial_memories` already carry the required columns
  and policies (verified in the Phase 3A migration).

## 8. Advanced analytics design (`analytics.ts`)

Deterministic, bounded, evidence-carrying. Every metric declares its window and
its source, and returns an explicit insufficient-data state instead of a guess.

| Metric | Deterministic definition | Minimum evidence |
| --- | --- | --- |
| Spending trend | per-period expense totals; direction + slope over N periods | ≥2 periods with expenses |
| Income trend | per-period income totals; direction + cadence | ≥2 periods with income |
| Category trend | per-category per-period totals; delta + % change | ≥2 periods, ≥3 transactions in category |
| Recurring concentration | sum(recurring monthly equivalents) ÷ monthly expenses/income | ≥1 active recurring |
| Savings trend | per-period savings rate from `computeMonthlyFlow` semantics | ≥2 periods with income |
| Budget utilisation pattern | per-budget spent ÷ limit, per period, plus persistence (over/under count) | ≥1 budget with a limit |
| Balance trend | per-period closing balance, replayed from `initialBalance` + transaction effects | ≥2 periods, ≥1 account |
| Transaction frequency | count per period, plus per-week density | ≥1 period with transactions |
| Spending concentration | top-N category share of expenses; HHI-style concentration | ≥1 period, ≥3 expense transactions |
| Month-over-month change | current vs prior period deltas for income, expenses, savings rate | current + prior period both present |
| Unusual change | MoM delta beyond a documented, configurable band | prior period present, band exceeded |

Shapes: `PeriodSeries`, `TrendSummary { direction, deltaAbsolute, deltaPercent,
periods }`, `CategoryTrend`, `AnalyticsResult { metrics, insufficientData[],
evidence }`. Period bucketing reuses `isInCurrentMonth`-style local-month logic
extended with a `monthStartsOn` preference hook (already declared in
`FinancialPreferences`).

No AI text, no fabricated insight: an analytics entry exists only when its
predicate is satisfied, and it always carries the numbers that produced it.

## 9. Hidden Spending design (`hiddenSpending.ts`)

Deterministic detectors over the transaction series and recurring schedules.
Each returns `HiddenSpendingFinding { ruleId, severity, confidence, title,
explanation, evidence, periodKey }` where `evidence` carries the supporting
transaction ids, the aggregate metrics, and the threshold used.

| Rule | Deterministic predicate | Guard rails |
| --- | --- | --- |
| `repeated_small_expenses` | count of expenses ≤ small-value band in window ≥ threshold, total ≥ absolute floor | never fires on < N transactions |
| `subscription_cluster` | active recurring items whose normalised description/merchant groups repeat; monthly equivalent share of income | uses recurring records, not guesses |
| `category_acceleration` | category total rose ≥ X% vs prior period with absolute floor met | requires prior-period baseline |
| `high_frequency_low_value` | ≥ N low-value expenses per week over ≥ K weeks | requires full window coverage |
| `income_share_overreach` | single category ≥ Y% of period income | requires income > 0 in period |
| `duplicate_like_recurring` | two recurring items with similar normalised label and amount within tolerance and compatible cadence | deterministic string/amount normalisation only |
| `latent_annual_commitments` | yearly recurring items whose monthly equivalent is material | reported separately, never as "error" |

Every finding is explainable: rule id + threshold + the exact transactions that
satisfied it. Nothing is labelled "hidden spending" without evidence, and a rule
that lacks evidence returns nothing (not a low-confidence claim).

## 10. Smart financial alerts design (`alerts.ts`)

A rule engine over outputs that already exist (twin + analytics + hidden
spending + engine metrics). Alerts never recalculate anything.

```ts
interface FinancialAlert {
  fingerprint: string;   // stable: ruleId + subjectKey + periodKey
  ruleId: AlertRuleId;
  severity: 'info' | 'notice' | 'warning' | 'critical';
  title: string;         // deterministic, templated
  explanation: string;   // deterministic, templated
  evidence: AlertEvidence; // metrics + source ids + threshold + period
  periodKey: string;
  status: 'active' | 'dismissed';
}
```

| Rule | Trigger (deterministic) | Source |
| --- | --- | --- |
| `unusual_spending_increase` | expenses MoM delta beyond band | analytics |
| `budget_utilization_threshold` | budget utilised ≥ threshold, or exceeded | engine + budgets |
| `recurring_expense_increase` | recurring monthly equivalent rose vs prior snapshot | recurring + snapshots |
| `low_financial_buffer` | `bufferMonths` below threshold | engine |
| `declining_savings` | savings rate fell across N periods | analytics |
| `goal_behind_schedule` | goal progress below linear-pace expectation with target date | goals |
| `significant_balance_change` | balance or net worth delta beyond band vs prior snapshot | snapshots |
| `repeated_spending_pattern` | a hidden-spending rule fired with sustained evidence | hidden spending |

Guarantees: explainable (every alert names its rule and numbers), deterministic
(same state → same alerts), tied to real data, **non-duplicative** (one active
alert per `fingerprint`), and no alert is emitted to populate the UI.

Alert persistence and dismissal (decision required in 4D, documented before
coding — this is the **only** open schema question in Phase 4):

- **Default plan (no schema change):** persist alerts as `financial_insights`
  rows with `type = 'alert'` and the fingerprint stored in `category`; dedup by
  reading existing rows for the period; dismissal = `status='dismissed'` recorded
  through the existing `financial_insights_update_own` UPDATE policy (state
  encoded in an existing mutable text field), so the alert row is never recreated.
- **Fallback if that proves too lossy:** a small additive migration for a
  dismissal column/table, documented with justification (which existing table
  cannot support it), exact DDL, and RLS implications — the only place Phase 4
  may touch a migration.
- Derive-only mode is always available (session-scoped dismissal, nothing
  persisted) if neither is acceptable.

## 11. Financial memory design (`memory.ts`)

Structured financial intelligence — **not** a chat transcript, never AI-authored
facts, never fabricated.

```ts
interface FinancialMemoryDraft {
  theme: 'spending' | 'goal' | 'risk' | 'habit' | 'milestone'; // existing CHECK
  title: string;            // templated from metrics
  description: string;      // templated from metrics
  context: {                // stored in the existing jsonb column
    triggerId: string;      // deterministic trigger
    idempotencyKey: string; // triggerId + periodKey (+ subject)
    periodKey: string;
    metrics: Record<string, number>;
    evidenceRefs: string[]; // transaction / budget / goal / snapshot ids
    ruleVersion: string;
  };
}
```

Deterministic triggers (only these create memory rows):
`category_spend_shift`, `recurring_commitment_added_changed`,
`savings_rate_band_change`, `budget_utilisation_band_change`,
`goal_contribution_pattern_changed`, `buffer_months_band_change`,
`net_worth_band_change`, `milestone_reached` (goal funded, debt cleared).

Rules: append-once per `idempotencyKey` (read existing keys first, then write),
templated text only, every memory traceable to metrics + source ids, and no
write when the trigger predicate is not met. Memories are read back (bounded
limit) for the memory timeline UI; feeding them into Copilot context is a later
phase and is explicitly out of Phase 4 scope.

## 12. Security / data ownership model

- Identity comes only from the verified session (`auth.getUser()`); no
  client-supplied user id is ever trusted — the same rule Phase 3E locked.
- New repository code uses the browser-safe client (anon key) only. No
  service-role key, no provider secret, no privileged credential reaches the
  frontend. `supabase/functions/finwise-copilot/scope.ts` is untouched.
- RLS remains the authoritative check: `financial_snapshots`,
  `financial_insights`, and `financial_memories` all carry
  `user_id = (select auth.uid())` policies for select/insert (+ delete; + update
  for insights and memories). Anonymous access stays revoked. No policy is
  weakened, added to, or replaced.
- Derived intelligence is user-scoped by construction: it is computed from the
  caller's own loaded collections and persisted with the session user id.
- No Phase 4 write path mutates Phase 2/3 financial truth
  (`accounts`, `transactions`, `budgets`, `goals`, `recurring_transactions`,
  `categories`, `profiles` remain owned by the existing services only).

## 13. UI integration plan (no redesign)

Existing shell is preserved; Phase 4 adds surfaces inside it. Navigation lives in
`src/config/routes.ts` (rendered by `Sidebar` + `MobileNav`), pages under
`src/pages/`, shared primitives in `src/components/ui/*`.

| Surface | Content | Change type |
| --- | --- | --- |
| **Overview** (`/overview`) | active alerts strip (top N, dismissible, "why" detail) + compact Digital Twin headline (health score, Safe-to-Spend, buffer, net worth, with MoM delta) | additive sections in `OverviewPage.tsx`; existing cards untouched |
| **Analytics** (`/analytics`) | trends (income/expense/savings), month-over-month deltas, category trends, budget utilisation patterns, spending concentration, hidden-spending findings, memory timeline | `AnalyticsPage.tsx` extended; the existing three cards remain |
| **Digital Twin** (new `/digital-twin`) | progressive disclosure: State → Behaviour → Health → Relationships, each with an explicit "what data produced this" affordance and insufficient-data states | new page + route entry in `routes.ts` (+ `App.tsx`, `Sidebar`, `MobileNav`) |
| **Privacy Center** (`/privacy`) | memory transparency: what FinWise remembers (list + delete), derived-artifact explanation | additive section in `PrivacyCenterPage.tsx` (4E) |
| **Copilot** (`/ai-assistant`) | unchanged in Phase 4 | no change |
| **Future Lab** (`/future-lab`) | unchanged in Phase 4 | no change |

Progressive disclosure rules: headline number first, evidence on demand; every
card that shows a derived value links to its supporting data; empty and
insufficient-data states are designed, never faked. No new design system, no
navigation rewrite, no page replaced.

## 14. Performance considerations

- **Derive once.** One `FinancialIntelligenceProvider` derivation per financial
  state change (`useMemo` on the store state), exposing twin, analytics, hidden
  spending, alerts, and memory to every consumer. No component derives its own.
- **No duplicate reducers.** Category totals, period buckets, and flows come from
  single primitives shared by all Phase 4 modules.
- **Bounded I/O.** Intelligence history is fetched once per hydration
  (latest 12 snapshots + latest 50 memories) in parallel with existing loads.
  No per-component queries, no polling, no realtime subscriptions added.
- **Guarded writes.** Snapshot capture is keyed by period key with a
  material-change predicate; alerts are fingerprint-deduped; memories are
  idempotency-key-deduped — so repeated renders or refreshes cannot spam rows.
- **No new heavy dependencies**; existing money/date/currency libs are reused.

## 15. Explainability model

Every Phase 4 artifact answers "what financial data caused this?" by carrying
structured evidence:

```ts
interface Evidence {
  ruleId: string;          // stable rule identifier
  ruleVersion: string;     // bumped when the threshold/logic changes
  periodKey: string;       // the window the claim applies to
  metrics: Record<string, number>;   // the exact numbers used
  thresholds: Record<string, number>; // the exact bands applied
  sourceRefs: SourceRef[]; // { collection, id } of supporting rows
  computedAt: string;
}
```

Rules: no claim without evidence; thresholds are named constants (never inline
magic numbers); the UI can render the numbers behind any insight, alert, memory,
or twin branch; AI explanation (Copilot) may narrate an artifact but never
produces or alters a number. Deterministic rule ids + versions make every
artifact reproducible from the same persisted data.

## 16. Proposed Phase 4 sub-phases

The requested top-level split is kept (4A–4E); only 4C and 4D get internal
stages, because each contains two independent capability sets and shipping them
in one step would make verification too coarse.

| Sub-phase | Scope | Exit criteria |
| --- | --- | --- |
| **4A** | this document — architecture + scope lock | architecture approved; no code changed |
| **4B** | Financial Digital Twin: evidence primitives (`primitives.ts`), twin assembly (`digitalTwin.ts`), snapshot/insight read + guarded write ops on `FinancialRepository`, `SupabaseRepository`, `LocalStorageRepository`, `financialIntelligenceContext.tsx`, `/digital-twin` page + route | twin renders from real data with evidence and insufficient-data states; no duplicate calculation; build + lint + 3A/3B/3D green |
| **4C-1** | Advanced analytics (`analytics.ts`) + analytics UI | trends, MoM, category trends, concentration, budget utilisation, balance trend; explicit insufficient-data states |
| **4C-2** | Hidden spending detector (`hiddenSpending.ts` + `findings.ts`) + findings UI | five detector rules with evidence; no finding without evidence; deterministic and stable across renders |
| **4D-1** | Smart alerts (`alerts.ts`) + alert UI + persistence/dismissal decision resolved and documented first | 8 rules; fingerprint dedup; honest empty state; explainable dismissible alerts |
| **4D-2** | Financial memory (`memory.ts`) + memory timeline UI + memory transparency | deterministic triggers; templated, evidence-backed text; idempotent writes; user-deletable |
| **4E** | Integration + verification: shared provider wiring review, performance pass, explainability audit, privacy surfaces, `verify_phase4.mjs` + `PHASE_4_VERIFICATION.md` | full Phase 4 verification green; Phase 2/3 checks still green; Copilot still read-only |

## 17. Files that would be modified in each sub-phase

**4B** — new: `src/intelligence/phase4/types.ts`, `primitives.ts`,
`digitalTwin.ts`, `src/features/intelligence/financialIntelligenceContext.tsx`,
`financialIntelligenceContextCore.ts`, `useFinancialIntelligence.ts`,
`src/pages/DigitalTwinPage.tsx`. Modified: `src/services/financial/repository.ts`
(additive options), `src/services/supabase/supabaseRepository.ts` (additive),
`src/services/financial/localStorageRepository.ts` (additive, fallback),
`src/features/dashboard/financialDataContext.tsx` (additive provider wiring),
`src/config/routes.ts`, `src/App.tsx`, `src/components/layout/Sidebar.tsx`,
`src/components/layout/MobileNav.tsx`.

**4C-1** — new: `analytics.ts` (+ types). Modified: `financialIntelligenceContext.tsx`,
`src/pages/AnalyticsPage.tsx`.

**4C-2** — new: `hiddenSpending.ts`, `findings.ts`, `src/components/ui/FindingsList.tsx`.
Modified: `financialIntelligenceContext.tsx`, `src/pages/AnalyticsPage.tsx`.

**4D-1** — new: `alerts.ts`, `src/components/ui/AlertList.tsx`. Modified:
`financialIntelligenceContext.tsx`, `src/pages/OverviewPage.tsx`,
`supabaseRepository.ts` + `localStorageRepository.ts` (fingerprint dedup read).

**4D-2** — new: `memory.ts`, `src/components/ui/MemoryTimeline.tsx`. Modified:
`financialIntelligenceContext.tsx`, `src/pages/AnalyticsPage.tsx`,
`src/pages/PrivacyCenterPage.tsx`, `supabaseRepository.ts` +
`localStorageRepository.ts` (memory read/write).

**4E** — new: `verify_phase4.mjs`, `PHASE_4_VERIFICATION.md`. Modified: as
needed for integration/perf/explainability fixes; no new capabilities.

## 18. Files that must remain untouched

- `src/intelligence/finance.ts` — Phase 2 engine (numbers stay authoritative).
- `src/services/financial/*Service.ts`, `state.ts`, `stateHelpers.ts`,
  `result.ts`, `validation.ts` — Phase 2 business logic.
- `src/features/auth/*`, `src/services/supabase/config.ts` and `client.ts` —
  Phase 3B/3E auth + config boundary.
- `supabase/migrations/**` — Phase 3A schema/RLS (unless an unavoidable 4D
  schema decision is explicitly approved and documented).
- `supabase/functions/**` (incl. `finwise-copilot/index.ts` and `scope.ts`) —
  Phase 3C/3E Copilot and Edge security.
- `src/types/financial.ts` existing Phase 1/2/3 domain types (additive Phase 4
  types live in the new `phase4/types.ts`).
- `src/lib/*`, `src/config/categories.ts`, `src/config/currencies.ts`.
- All existing verification scripts (`verify_phase3a/3b/3d.mjs`,
  `verify_live_phase3a.mjs`) and their expectations.
- `package.json` dependencies (no new packages planned).

## 19. Risks and dependencies

| Risk | Impact | Mitigation |
| --- | --- | --- |
| New repository ops widen the Phase 3 persistence boundary | Phase 3 regression | additive optional methods only; existing methods, tables, and RLS untouched; re-run 3A/3B/3D after each sub-phase |
| Snapshot/insight/memory writes could duplicate rows | unclean data | period-key + fingerprint + idempotency-key dedup before writing; append-only snapshot policy respected (no UPDATE) |
| Multi-currency data | WRONG cross-currency totals | Phase 4 derives primary-currency totals by filtering on the profile's `primaryCurrency`, matching the Copilot context behaviour; documented limitation, no invented conversion logic |
| Insufficient data | fabricated insights | explicit insufficient-data state throughout; no claim without evidence |
| Alert dismissal has no dedicated column | persistence ambiguity | decision escalated and resolved in 4D-1 *before* coding, with the no-schema-change default documented |
| Provider dependency | none | Phase 4 is deterministic only — no AI provider, no secrets, no network calls |
| Analytics performance on long histories | slow UI | single derivation per state change, bounded history fetches |
| Adding a new route could disturb navigation | UX regression | route added via existing `routes.ts` pattern; sidebar/mobile nav additive entries only |

Dependencies: Phase 3 locked infrastructure (done), no new packages, and the
resolved alert-dismissal decision.

## 20. Explicit confirmation — Phase 3 remains LOCKED

- Phase 3A/3B/3C/3D/3E/3F are **not** modified by this phase: no source file, no
  migration, no RLS policy, no Edge Function, no secret, and no schema was
  changed.
- Phase 4 consumes Phase 2/3 outputs and adds strictly additive, user-scoped
  derived intelligence.
- The Phase 3 architecture (`React UI → services → FinancialRepository →
  SupabaseRepository → Supabase/PostgreSQL + RLS`) is unchanged and remains the
  only persistence path.

---

PHASE 4A — ARCHITECTURE READY
NO IMPLEMENTATION PERFORMED
PHASE 3 REMAINS LOCKED

**Execution time:** estimated 25–35 min → **actual ≈ 27 minutes.**
**Blockers:** one shell output-capture loss (the terminal closed before stdout
was observed; the file was written and re-read successfully) — no impact on
results.

**Files created:** `PHASE_4A_ARCHITECTURE.md` (documentation/scope-lock artifact
only). **Files modified:** none. **Files deleted:** none.








