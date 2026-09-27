# Phase 4B — Financial Digital Twin: Completion Report

Status: **complete and verified — build, lint, all Phase 3 regressions green,
and the Phase 4B manual functional suite ALL PASS (43/43), re-run against the
current tree after the duplicate-snapshot fix in §4 and the same-day capture
guard refinement in §5.**
Phase 3 remains locked. This report documents what Phase 4B built, on top of
which verified Phase 3 primitives, and the verification evidence.

> **Superseded evidence.** An earlier manual run (21-09-2026 15:33) recorded
> `FAILURES PRESENT (37/43)`. That result is **superseded by §5** and is kept only
> as history: it was taken against the pre-fix tree, with a harness whose
> assertions were themselves wrong (§4.1). It is not a statement about the code
> as it stands today.

## 1. Scope (per PHASE_4A_ARCHITECTURE.md §16, row 4B)

Financial Digital Twin only: evidence primitives, twin assembly, additive
intelligence read + guarded write operations, the derive-once provider, and the
`/digital-twin` page with route and navigation. No Phase 4C work was started.

## 2. What was built

### Intelligence layer (pure, deterministic, no I/O)

| File | Role |
| --- | --- |
| `src/types/intelligence.ts` | Types-only Phase 4 contract: `Evidence`, `SourceRef`, `SourceCollection`, `InsufficientDataCode`/`Reason`, `AvailableSection` / `InsufficientDataSection` / `IntelligenceSection`. Imports no logic, storage, network or AI. |
| `src/intelligence/evidence.ts` | Pure evidence primitives: `buildEvidence` (metrics, thresholds, source refs and rule version are mandatory parts of one object), `periodKeyOf`, `sourceRef`, `dedupeSourceRefs`, `insufficient`, `countByCollection`, `sharePercent`. Clock is always injected. Rule version stamped `4b.1`. |
| `src/intelligence/section.ts` | Pure section primitives: `available` / `unavailable` (evidence or reason mandatory by construction), `isAvailable`, `isUnavailableBecause`, `withNote`, `mergeReasons`. There is deliberately no third state. |
| `src/intelligence/twin.ts` | Twin assembly: `buildFinancialTwin` derives the State, Behaviour, Health and Relationships sections from persisted data plus the authoritative `DashboardMetrics` (engine outputs reused verbatim, never recomputed). Also the guarded snapshot memory: `buildSnapshotDraft` (strictly from engine output; `null` when a NOT NULL snapshot column is not derivable) and `snapshotCaptureReason` — at most one snapshot per local day, recaptured only on the documented material-change bands (net worth 1%, Safe-to-Spend 1%, health score 1 point). |

### Persistence (additive sibling — `FinancialRepository` untouched)

| File | Role |
| --- | --- |
| `src/services/financial/intelligenceRepository.ts` | `FinancialIntelligenceRepository` (`loadSnapshots`/`saveSnapshot`, `loadInsights`/`saveInsight`/`updateInsight`/`deleteInsight`) + `boundedLimit`. Snapshots are append-only (the table has no UPDATE policy); memory operations arrive with 4D-2 and are deliberately absent. |
| `src/services/financial/intelligenceRepositoryFactory.ts` | Sanctioned selection: Supabase configured + authenticated session → `SupabaseIntelligenceRepository`; otherwise `LocalStorageIntelligenceRepository` fallback. Mirrors the Phase 3B rule. |
| `src/services/supabase/supabaseIntelligenceRepository.ts` | Production impl: browser-safe anon client only, identity injected from the verified session (`requireUserId` throws without one), RLS the authoritative check, PostgREST column lists centralised, snapshot inserts omit `id`/`captured_at` so the Phase 3A defaults apply. |
| `src/services/financial/localStorageIntelligenceRepository.ts` | Deliberate unconfigured-environment fallback: defensive reads (malformed rows dropped), append-only snapshots, bounded lists (60), storage failures never crash. |
| `src/services/supabase/mappers.ts` (additive) | `toAppFinancialSnapshot`, `toFinancialSnapshotInsert`, `toAppFinancialInsight`, `toFinancialInsightInsert`, `toFinancialInsightUpdate`. No migration, no new table, no RLS change — the Phase 3A tables and policies are consumed as they are. |

### Provider / hook / UI

| File | Role |
| --- | --- |
| `src/features/intelligence/financialIntelligenceContextCore.ts` | Context + value types, split from the component for the react-refresh rule (same pattern as the other context cores). |
| `src/features/intelligence/financialIntelligenceContext.tsx` | `FinancialIntelligenceProvider`: keyed remount per persistence identity (sign-in/out/switch can never leak one user's intelligence into another's); derives the twin ONCE per financial state change; owns the guarded automatic snapshot capture (predicate + per-signature attempt dedupe + re-entry guards, and the bounded history read must settle before the predicate fires — see §4) and the bounded (12) snapshot history read; configured-but-signed-out holds an honest empty state. |
| `src/features/intelligence/useFinancialIntelligence.ts` | Consuming hook (throws outside the provider). |
| `src/pages/DigitalTwinPage.tsx` | Progressive disclosure: State → Behaviour → Health → Relationships. Every available section renders the evidence that produced it; every insufficient section explains *why* it is empty (named missing collections) instead of showing a zero. Snapshot history with capture status and a manual capture action. |

### Wiring (additive)

- `src/main.tsx` — provider order: `AuthProvider` → `FinancialDataProvider` →
  `FinancialIntelligenceProvider` → `CopilotProvider`. The twin derives from the
  persisted data above it; pages consume it via context and never re-derive.
- `src/config/routes.ts` — `digital-twin` entry (`/digital-twin`).
- `src/App.tsx` — route inside the `RequireAuth`-protected shell.
- `src/components/layout/Sidebar.tsx`, `MobileNav.tsx` — additive `Fingerprint`
  icon entry; both render from the single `appRoutes` configuration.

## 3. Session fix 1 — `react-hooks/set-state-in-effect` (final lint error)

`react-hooks/set-state-in-effect` flagged the snapshot-history hydration effect
(`void refreshSnapshots()` in an effect body). Fixed by adopting the exact
repository-then-commit shape already proven in `financialDataContext.tsx`: the
effect calls the repository directly and every setState runs inside the
`.then()` callbacks. `refreshSnapshots` (still used for the post-capture
refresh) now yields before stamping the load sequence and clears
`snapshotsLoading` explicitly — no setState in a `finally` block. Behaviour
preserved: the sequence stamp discards superseded loads; the first-load spinner
is covered by `useState(true)`; the guarded capture flow is unchanged.

## 4. Session fix 2 — duplicate snapshot captured on reload (Phase 4B defect)

The first Phase 4B manual functional run caught a **genuine Phase 4B defect**: after
a page reload on the same local day the twin captured a *second* snapshot
(`count=2`), which also broke the reload-determinism check (the rendered
"Twin memory 1 snapshot captured" became "2 snapshots captured"). This is exactly
the "no duplicate calculation / at most one snapshot per day" guarantee of
Phase 4A §6B, so it had to be fixed before Phase 4B could be called complete.

Root cause: the automatic-capture effect decided from `snapshots[0]`, but the
bounded history read is asynchronous. On a reload the effect ran *before*
`loadSnapshots` had resolved, so `snapshots` was still the empty initial state,
the day looked like a first visit, and `snapshotCaptureReason` returned
`first_snapshot` — writing a duplicate memory row.

Fix — `src/features/intelligence/financialIntelligenceContext.tsx`, the **only**
application change made after the original build:

```ts
// The bounded history read must settle before the predicate decides: until
// it resolves `snapshots` is empty, so a returning visit (page reload the
// same day) would look like `first_snapshot` and write a duplicate memory
// row. `snapshotsLoading` is cleared on both the success and the failure
// path, so an unreadable history still allows an honest first capture.
if (!readEnabled || draft === null || capturing || snapshotsLoading) return;
```

with `snapshotsLoading` added to the effect dependencies. Behaviour preserved:
one snapshot per local day (recaptured only inside the documented material-change
bands), the write still goes through `FinancialIntelligenceRepository`, rendering
still never mutates financial data, and a failed history read still permits an
honest first capture rather than silently skipping memory. No Phase 3 file, no
migration, no RLS policy and no `tsconfig` was touched.

### 4.1 Harness corrections (test code only — not application bugs)

`p4b-manual-test.cjs` assertions were wrong and were corrected. Each was proven
against the recorded render *before* being changed, so no application source was
altered to satisfy a test:

| Assertion | Was | Now |
| --- | --- | --- |
| T6 overview | hardcoded net worth 2,70,500, read from a stale pre-seed dump | `Total balance` = 2,49,500, re-derived from initial balance + seeded transactions |
| T3 twin net worth | 2,70,500 via a case-sensitive lookup that matched the *Health section's* prose line and then returned the next line (`Health score: …`) | 2,49,500 via a case-insensitive StatCard-label lookup |
| T4 empty data | "net worth shows no number" | asserts the em-dash placeholder `—` (no fabricated 0 / currency value) |
| `lineAfter` helper | returned `lines[i + 1]`, which is a *blank* line because `innerText` puts an empty line between block elements (a StatCard's label `<p>` and its value `<p>`) | skips blank lines and returns the first non-empty line |

The seeded net worth is deterministically 2,49,500 (Test Checking 79,500 + Test
Savings 170,000); the earlier 2,70,500 expectation was simply wrong.

## 5. Verification (current tree, 21-09-2026)

Re-run after the §4 fix; every line below describes the code as it stands on disk.
Raw output: `build-out.txt`, `lint-out.txt`, `p4b-verify3a/b/d.txt`,
`p4b-manual-report.txt`, `p4b-manual-results.json`.

| Check | Result |
| --- | --- |
| `tsc -b` | exit 0 |
| `vite build` | exit 0 (1760 modules; pre-existing >500 kB chunk advisory only) — `dist/` refreshed after verification (`index-CTr41asN.js`) |
| `eslint .` | exit 0 (0 problems) |
| `node verify_phase3a.mjs` | ALL CHECKS PASSED (exit 0) |
| `node verify_phase3b.mjs` | ALL CHECKS PASSED (exit 0) |
| `node verify_phase3d.mjs` | ALL CHECKS PASSED (exit 0) |
| `node p4b-manual-test.cjs` | **ALL PASS (43/43)**, exit 0 |

Manual suite highlights (all PASS): local-mode load with Supabase unconfigured;
Sidebar *and* MobileNav reach `/digital-twin`; State / Behaviour / Health /
Relationships all render, each available section carrying an `Evidence:` line with
rule version `v4b.1`; stat cards render; net worth = ₹2,49,500 re-derived from
seeded accounts + transactions; groceries 16,500 derived from transactions;
relationships link real rows; **exactly 1 snapshot captured, and still exactly 1
after a reload (no duplicate)**; twin text byte-identical across the reload
(deterministic, no time drift); empty data shows named missing collections and `—`
placeholders (no fabricated numbers) with 0 snapshots; no horizontal overflow at
1440px or 390px; no service-role key / secret / API key / JWT / hardcoded UUID;
no core-table access, admin client or auth bypass; twin path makes no AI/API call;
zero off-origin requests (445, all same-origin); no console errors, no page
exceptions, no failed requests.

## 6. Untouched (verified by inspection)

`src/intelligence/finance.ts`; `src/services/financial/repository.ts`,
`*Service.ts`, `state.ts`, `stateHelpers.ts`, `result.ts`, `validation.ts`,
`localStorageRepository.ts`; `src/features/auth/*`;
`src/services/supabase/config.ts`, `client.ts`, `supabaseRepository.ts`,
`database.types.ts`; `supabase/migrations/**`; `supabase/functions/**`
(`finwise-copilot` remains read-only); `src/lib/*`;
`src/config/categories.ts`, `currencies.ts`; all `verify_phase3*.mjs` scripts;
`tsconfig*.json`; `package.json` (no new packages). No database migration, no
RLS change, no AI provider, no secrets, no network calls in the twin path.

## 7. Next (not started)

Phase 4C-1 — Advanced analytics (`analytics.ts` + analytics UI), per
PHASE_4A_ARCHITECTURE.md §16. The intelligence provider is the designated
integration point (`financialIntelligenceContext.tsx`).

---

PHASE 4B — DIGITAL TWIN COMPLETE AND VERIFIED
43/43 MANUAL FUNCTIONAL SUITE · BUILD · LINT · PHASE 3A/3B/3D GREEN
PHASE 3 REMAINS LOCKED

