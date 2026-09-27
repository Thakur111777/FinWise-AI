import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  FinancialIntelligenceContext,
  type FinancialIntelligenceContextValue,
} from './financialIntelligenceContextCore';
import { useAuth } from '../auth/useAuth';
import { useFinancialData } from '../dashboard/useFinancialData';
import { useDashboardMetrics } from '../dashboard/useDashboardMetrics';
import { createFinancialIntelligenceRepository } from '../../services/financial/intelligenceRepositoryFactory';
import type { FinancialIntelligenceRepository } from '../../services/financial/intelligenceRepository';
import type { FinancialSnapshot } from '../../types/financial';
import { buildFinancialTwin, buildSnapshotDraft, snapshotCaptureReason, snapshotDayKey } from '../../intelligence/twin';
import { toISODate } from '../../lib/date';

/**
 * Financial Intelligence Provider (Phase 4B) — derives the Digital Twin once
 * per financial state change and owns the guarded snapshot memory.
 *
 *   persisted financial data (FinancialDataProvider)
 *     -> engine metrics (useDashboardMetrics — authoritative, reused)
 *     -> buildFinancialTwin (pure, evidence-carrying)
 *     -> this context
 *     -> UI pages (render only; never re-derive)
 *
 * REPOSITORY SELECTION mirrors the Financial Data store: it goes through
 * `createFinancialIntelligenceRepository` (financialDataContext.tsx), the app's
 * sanctioned repository-selection point, so this provider never imports
 * `services/supabase` directly.
 *   * Supabase configured + authenticated -> SupabaseIntelligenceRepository
 *     (RLS-scoped, session identity).
 *   * Supabase not configured -> LocalStorageIntelligenceRepository fallback.
 *   * Supabase configured but signed out -> an honest empty state; local
 *     intelligence storage is never read or written behind an authenticated
 *     user's back.
 *
 * SNAPSHOT CAPTURE (Phase 4A §6B): automatic, guarded, idempotent — at most
 * one snapshot per local day, recaptured only when the documented
 * material-change predicate fires. Every write goes through the repository.
 */

/** Bounded history read at hydration (Phase 4A §14: latest 12 snapshots). */
const SNAPSHOT_HISTORY_LIMIT = 12;

/** Stable empty list so derived context values keep a stable identity. */
const EMPTY_SNAPSHOTS: FinancialSnapshot[] = [];

/** Stable fingerprint of a draft, used to avoid retry loops after a failure. */
function draftFingerprint(draft: {
  netWorth: number;
  cashFlow: number;
  safeToSpend: number;
  financialHealthScore: number;
  income: number;
  expenses: number;
  savingsRate: number;
  debt: number;
}): string {
  return [
    draft.netWorth,
    draft.cashFlow,
    draft.safeToSpend,
    draft.financialHealthScore,
    draft.income,
    draft.expenses,
    draft.savingsRate,
    draft.debt,
  ].join('|');
}

export function FinancialIntelligenceProvider({ children }: { children: ReactNode }) {
  const { user, isLocalMode } = useAuth();

  /**
   * Keyed remounting (the same external-store reset pattern as the financial
   * data store): when the identity changes — sign-in, sign-out, or account
   * switch — the whole store below unmounts and a fresh one mounts with clean
   * state, so one user's intelligence never leaks into another's.
   */
  const persistenceIdentity = isLocalMode ? 'local' : (user?.id ?? 'signed-out');

  return <FinancialIntelligenceStore key={persistenceIdentity}>{children}</FinancialIntelligenceStore>;
}

function FinancialIntelligenceStore({ children }: { children: ReactNode }) {
  const { user, isLocalMode } = useAuth();
  const data = useFinancialData();
  const metrics = useDashboardMetrics();

  const authUserId = user?.id ?? null;
  // A configured app with a signed-out visitor holds an honest empty state.
  const signedOutConfigured = !isLocalMode && authUserId === null;

  const repository = useMemo<FinancialIntelligenceRepository>(
    () => createFinancialIntelligenceRepository(user === null ? null : { id: user.id }),
    [user],
  );

  // -- Derivation (once per financial state change) ---------------------------
  const twin = useMemo(
    () =>
      buildFinancialTwin({
        now: new Date(),
        profile: data.profile,
        accounts: data.accounts,
        categories: data.categories,
        transactions: data.transactions,
        budgets: data.budgets,
        goals: data.goals,
        recurringTransactions: data.recurringTransactions,
        metrics,
      }),
    [data, metrics],
  );

  const draft = useMemo(
    () =>
      data.isHydrated && !signedOutConfigured
        ? buildSnapshotDraft({ metrics, currencyCode: data.profile?.primaryCurrency ?? null })
        : null,
    [data.isHydrated, data.profile, metrics, signedOutConfigured],
  );

  // -- Snapshot memory (read) --------------------------------------------------
  const [snapshots, setSnapshots] = useState<FinancialSnapshot[]>([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(true);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const loadSequence = useRef(0);

  /**
   * True when the store may read the repository: hydrated, and never behind an
   * authenticated user's back (the configured-but-signed-out case holds an
   * honest empty state instead of local data).
   */
  const readEnabled = data.isHydrated && !signedOutConfigured;

  const refreshSnapshots = useCallback(async (): Promise<void> => {
    // Re-read the snapshot history after a capture (never called synchronously
    // from an effect body — the hydration effect below commits state in promise
    // callbacks instead). It yields before touching any state and stamps the
    // load sequence after the yield: two refreshes started in the same tick
    // still stamp in call order, so the latest load always wins.
    await Promise.resolve();
    const sequence = ++loadSequence.current;
    try {
      // `snapshotsLoading` starts true from useState, covering the first load;
      // it is cleared only when this load is still the latest one.
      const loaded = await repository.loadSnapshots(SNAPSHOT_HISTORY_LIMIT);
      if (sequence !== loadSequence.current) return;
      setSnapshots(loaded);
      setSnapshotError(null);
      setSnapshotsLoading(false);
    } catch (error) {
      if (sequence !== loadSequence.current) return;
      setSnapshotError(error instanceof Error ? error.message : 'Could not load your Digital Twin history.');
      setSnapshotsLoading(false);
    }
  }, [repository]);

  /**
   * Hydrate the bounded snapshot history — the same repository-then-commit
   * shape as the financial data hydration in financialDataContext.tsx: the
   * read starts in the effect, but every setState runs inside the promise
   * callbacks, never synchronously in the effect body
   * (react-hooks/set-state-in-effect). Superseded loads are discarded via the
   * sequence stamp, so the latest read always wins.
   */
  useEffect(() => {
    if (!readEnabled) return;
    const sequence = ++loadSequence.current;

    void repository.loadSnapshots(SNAPSHOT_HISTORY_LIMIT).then(
      (loaded) => {
        if (sequence !== loadSequence.current) return;
        setSnapshots(loaded);
        setSnapshotError(null);
        setSnapshotsLoading(false);
      },
      (error: unknown) => {
        if (sequence !== loadSequence.current) return;
        setSnapshotError(error instanceof Error ? error.message : 'Could not load your Digital Twin history.');
        setSnapshotsLoading(false);
      },
    );
  }, [readEnabled, repository]);

  // Derived — never reset inside an effect (no cascading setState): the
  // visible history is empty while the store hydrates and for the
  // configured-but-signed-out case. One user's history can never leak into
  // another's because the whole store remounts per persistence identity.
  const visibleSnapshots = readEnabled ? snapshots : EMPTY_SNAPSHOTS;
  const visibleSnapshotsLoading = readEnabled ? snapshotsLoading : !data.isHydrated;

  // -- Snapshot capture (guarded write) ----------------------------------------
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const lastCaptureAttempt = useRef<string | null>(null);

  const runCapture = useCallback(async (): Promise<void> => {
    if (draft === null) return;
    // Yield once so a predicate-triggered capture never sets state
    // synchronously inside an effect body (react-hooks/set-state-in-effect).
    // Re-entry stays impossible: the effect guards on `capturing`, the manual
    // button is disabled while capturing, and the signature ref dedupes.
    await Promise.resolve();
    setCapturing(true);
    setCaptureError(null);
    try {
      await repository.saveSnapshot(draft);
      await refreshSnapshots();
    } catch (error) {
      setCaptureError(error instanceof Error ? error.message : 'Could not save a Digital Twin snapshot.');
    } finally {
      setCapturing(false);
    }
  }, [draft, repository, refreshSnapshots]);

  const captureSnapshot = useCallback(async (): Promise<void> => {
    await runCapture();
  }, [runCapture]);

  // -- Same-day capture suppression (phase 4B) --------------------------------
  // Derived synchronously during render from the current snapshot list so the
  // capture effect and external consumers always see a consistent value without
  // a ref-to-state round-trip. The capture effect below uses this value as its
  // same-day guard; the manual button exposes it for diagnostics.
  const hasSnapshotForToday = useMemo(() => {
    if (!readEnabled || capturing || snapshotsLoading) return false;
    const target = toISODate(new Date());
    return snapshots.some((s) => s.capturedAt != null && snapshotDayKey(s.capturedAt) === target);
  }, [readEnabled, capturing, snapshotsLoading, snapshots]);

  const guardedCapture = useCallback(async (): Promise<void> => {
    if (draft === null) return;
    if (hasSnapshotForToday) return;
    await runCapture();
  }, [draft, hasSnapshotForToday, runCapture]);

  useEffect(() => {
    if (!readEnabled || draft === null || capturing || snapshotsLoading) return;
    const latest = snapshots[0] ?? null;
    const reason = snapshotCaptureReason({
      todayKey: toISODate(new Date()),
      latestSnapshot: latest,
      draft,
    });
    if (reason === 'none') return;
    // One attempt per (reason, latest snapshot, draft) signature so a failing
    // read-back can never turn the guarded capture into a retry loop.
    const signature = `${reason}:${latest?.id ?? 'none'}:${draftFingerprint(draft)}`;
    if (lastCaptureAttempt.current === signature) return;
    lastCaptureAttempt.current = signature;
    void guardedCapture();
  }, [readEnabled, draft, capturing, snapshots, snapshotsLoading, guardedCapture]);

  const value = useMemo<FinancialIntelligenceContextValue>(
    () => ({
      twin,
      snapshots: visibleSnapshots,
      snapshotsLoading: visibleSnapshotsLoading,
      snapshotError,
      capturing,
      captureError,
      hasSnapshotForToday: hasSnapshotForToday,
      actions: { captureSnapshot, guardedCapture },
    }),
    [twin, visibleSnapshots, visibleSnapshotsLoading, snapshotError, capturing, captureError, hasSnapshotForToday, captureSnapshot, guardedCapture],
  );

  return <FinancialIntelligenceContext.Provider value={value}>{children}</FinancialIntelligenceContext.Provider>;
}
