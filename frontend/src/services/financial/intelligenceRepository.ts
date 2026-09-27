import type { FinancialInsight, FinancialSnapshot } from '../../types/financial';

/**
 * Intelligence persistence boundary (Phase 4B).
 *
 * A separate, additive sibling of `FinancialRepository` (Phase 4A §7): the
 * Phase 3 financial-truth interface and its two implementations stay exactly
 * as they are. This interface only exposes the Phase 4 derived-intelligence
 * tables that already exist with full RLS (`financial_snapshots`,
 * `financial_insights`) — no migration, no policy change, no new table.
 *
 * Implementations:
 *   * `SupabaseIntelligenceRepository` — production; the caller's JWT through
 *     the browser-safe anon-key client, ownership resolved from the verified
 *     session, RLS the authoritative check.
 *   * `LocalStorageIntelligenceRepository` — the deliberate unconfigured-
 *     environment fallback, consistent with the Phase 2 local path.
 *
 * Writes are guarded upstream (idempotency: at most one snapshot per period
 * key plus a documented material-change predicate), so repeated renders or
 * refreshes cannot spam rows. Memory operations arrive with Phase 4D-2 and
 * are deliberately absent here.
 */

/** A snapshot to persist: `id`, `userId` and `capturedAt` are storage-owned. */
export type NewFinancialSnapshot = Omit<FinancialSnapshot, 'id' | 'userId' | 'capturedAt'>;

/** An insight to persist: `id`, `userId` and `createdAt` are storage-owned. */
export type NewFinancialInsight = Omit<FinancialInsight, 'id' | 'userId' | 'createdAt'>;

export interface FinancialIntelligenceRepository {
  /** Latest-first snapshot history, bounded by `limit`. */
  loadSnapshots(limit: number): Promise<FinancialSnapshot[]>;
  /** Append one snapshot (append-only: the table has no UPDATE policy). */
  saveSnapshot(snapshot: NewFinancialSnapshot): Promise<void>;
  /** Latest-first insight rows, bounded by `limit`. */
  loadInsights(limit: number): Promise<FinancialInsight[]>;
  saveInsight(insight: NewFinancialInsight): Promise<void>;
  /** Partial update (insights are the only intelligence row with an UPDATE policy). */
  updateInsight(id: string, patch: Partial<NewFinancialInsight>): Promise<void>;
  deleteInsight(id: string): Promise<void>;
}

/** Clamp a caller-supplied row limit into a safe PostgREST/SQL range. */
export function boundedLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 0;
  return Math.max(0, Math.trunc(limit));
}
