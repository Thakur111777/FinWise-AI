import type { FinancialInsight, FinancialSnapshot } from '../../types/financial';
import { createId } from './state';
import type { StorageLike } from './localStorageRepository';
import {
  boundedLimit,
  type FinancialIntelligenceRepository,
  type NewFinancialInsight,
  type NewFinancialSnapshot,
} from './intelligenceRepository';

/**
 * Local persistence for Phase 4 derived intelligence — the deliberate
 * fallback when Supabase is not configured, mirroring
 * `LocalStorageRepository` for the Financial Core (Phase 2).
 *
 * - Every read is defensive: corrupted or malformed rows are dropped instead
 *   of crashing the app.
 * - Snapshots are appended with a locally generated id and capture time; the
 *   append-only policy of the production table is respected.
 * - Lists are bounded so a storage key can never grow without limit.
 */
const KEYS = {
  snapshots: 'finwise.intelligence.snapshots.v1',
  insights: 'finwise.intelligence.insights.v1',
} as const;

/** History bound for the fallback store (bounded-load philosophy, Phase 4A §14). */
const MAX_LOCAL_ITEMS = 60;

/**
 * The local fallback has no server identity. Rows carry this owner marker so
 * the stored shape mirrors the domain model without inventing a fake user.
 */
const LOCAL_USER_ID = 'local';

function isWellFormedSnapshot(value: unknown): value is FinancialSnapshot {
  if (value === null || typeof value !== 'object') return false;
  const row = value as Partial<FinancialSnapshot>;
  return (
    typeof row.id === 'string' &&
    typeof row.userId === 'string' &&
    typeof row.capturedAt === 'string' &&
    typeof row.netWorth === 'number' && Number.isFinite(row.netWorth) &&
    typeof row.cashFlow === 'number' && Number.isFinite(row.cashFlow) &&
    typeof row.safeToSpend === 'number' && Number.isFinite(row.safeToSpend) &&
    typeof row.financialHealthScore === 'number' && Number.isFinite(row.financialHealthScore) &&
    typeof row.income === 'number' && Number.isFinite(row.income) &&
    typeof row.expenses === 'number' && Number.isFinite(row.expenses) &&
    typeof row.savingsRate === 'number' && Number.isFinite(row.savingsRate) &&
    typeof row.debt === 'number' && Number.isFinite(row.debt) &&
    typeof row.currencyCode === 'string'
  );
}

function isWellFormedInsight(value: unknown): value is FinancialInsight {
  if (value === null || typeof value !== 'object') return false;
  const row = value as Partial<FinancialInsight>;
  return (
    typeof row.id === 'string' &&
    typeof row.userId === 'string' &&
    (row.type === 'alert' ||
      row.type === 'optimization' ||
      row.type === 'forecast' ||
      row.type === 'risk' ||
      row.type === 'milestone') &&
    typeof row.title === 'string' &&
    typeof row.summary === 'string' &&
    typeof row.details === 'string' &&
    typeof row.confidence === 'number' && Number.isFinite(row.confidence) &&
    typeof row.createdAt === 'string'
  );
}

function byNewestFirst(a: FinancialSnapshot, b: FinancialSnapshot): number {
  if (a.capturedAt === b.capturedAt) return a.id < b.id ? 1 : -1;
  return a.capturedAt < b.capturedAt ? 1 : -1;
}

function byNewestCreated(a: FinancialInsight, b: FinancialInsight): number {
  if (a.createdAt === b.createdAt) return a.id < b.id ? 1 : -1;
  return a.createdAt < b.createdAt ? 1 : -1;
}

export class LocalStorageIntelligenceRepository implements FinancialIntelligenceRepository {
  private readonly storage: StorageLike | null;

  constructor(storage: StorageLike | null = typeof localStorage !== 'undefined' ? localStorage : null) {
    this.storage = storage;
  }

  async loadSnapshots(limit: number): Promise<FinancialSnapshot[]> {
    return this.readList(KEYS.snapshots, isWellFormedSnapshot)
      .sort(byNewestFirst)
      .slice(0, boundedLimit(limit));
  }

  async saveSnapshot(snapshot: NewFinancialSnapshot): Promise<void> {
    const row: FinancialSnapshot = {
      ...snapshot,
      id: createId('snap'),
      userId: LOCAL_USER_ID,
      capturedAt: new Date().toISOString(),
    };
    const rows = [...this.readList(KEYS.snapshots, isWellFormedSnapshot), row];
    this.write(KEYS.snapshots, rows.slice(-MAX_LOCAL_ITEMS));
  }

  async loadInsights(limit: number): Promise<FinancialInsight[]> {
    return this.readList(KEYS.insights, isWellFormedInsight)
      .sort(byNewestCreated)
      .slice(0, boundedLimit(limit));
  }

  async saveInsight(insight: NewFinancialInsight): Promise<void> {
    const row: FinancialInsight = {
      ...insight,
      id: createId('insight'),
      userId: LOCAL_USER_ID,
      createdAt: new Date().toISOString(),
    };
    const rows = [...this.readList(KEYS.insights, isWellFormedInsight), row];
    this.write(KEYS.insights, rows.slice(-MAX_LOCAL_ITEMS));
  }

  async updateInsight(id: string, patch: Partial<NewFinancialInsight>): Promise<void> {
    const rows = this.readList(KEYS.insights, isWellFormedInsight).map((row) =>
      row.id === id ? { ...row, ...patch } : row,
    );
    this.write(KEYS.insights, rows);
  }

  async deleteInsight(id: string): Promise<void> {
    const rows = this.readList(KEYS.insights, isWellFormedInsight).filter((row) => row.id !== id);
    this.write(KEYS.insights, rows);
  }

  /* ------------------------------- internals ------------------------------- */

  private readRaw(key: string): string | null {
    if (!this.storage) return null;
    try {
      return this.storage.getItem(key);
    } catch {
      return null;
    }
  }

  private parse(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  private readList<T>(key: string, isWellFormed: (value: unknown) => value is T): T[] {
    const raw = this.readRaw(key);
    if (raw === null) return [];
    const parsed = this.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isWellFormed) : [];
  }

  private write(key: string, value: unknown): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage full/unavailable — the in-memory state stays authoritative,
      // persistence failures never crash the app.
    }
  }
}
