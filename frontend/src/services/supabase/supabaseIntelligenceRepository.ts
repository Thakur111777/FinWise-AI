import type { SupabaseClient } from '@supabase/supabase-js';
import type { FinancialInsight, FinancialSnapshot } from '../../types/financial';
import {
  boundedLimit,
  type FinancialIntelligenceRepository,
  type NewFinancialInsight,
  type NewFinancialSnapshot,
} from '../financial/intelligenceRepository';
import {
  toAppFinancialInsight,
  toAppFinancialSnapshot,
  toFinancialInsightInsert,
  toFinancialInsightUpdate,
  toFinancialSnapshotInsert,
} from './mappers';
import type { FinancialInsightRow, FinancialSnapshotRow } from './database.types';

/**
 * Supabase-backed `FinancialIntelligenceRepository` — the production
 * persistence layer for Phase 4 derived intelligence (Phase 4B).
 *
 * Same locked boundary as `SupabaseRepository`: public anon key only, identity
 * resolved from the verified session (injected — never a UI-supplied user id),
 * and Row Level Security as the authoritative check on every statement. It
 * never carries a service-role key and never bypasses RLS.
 *
 * Writes respect the Phase 3A policies exactly:
 *   * `financial_snapshots` — select/insert/delete; inserts are append-only
 *     (`id`/`captured_at` are database defaults, never rewritten).
 *   * `financial_insights` — select/insert/update/delete.
 */
export interface SupabaseIntelligenceRepositoryOptions {
  /** A client built from the public anon key only. */
  client: SupabaseClient;
  /**
   * Resolve the authenticated user id (`auth.uid()`) from the verified session.
   * Supplied by the provider wiring (features/dashboard) so this class never
   * touches `supabase.auth` itself — auth stays centralised.
   */
  getUserId: () => Promise<string | null>;
}

/** PostgREST column lists, kept in one place so they can never drift. */
const COLUMNS = {
  snapshots:
    'id,user_id,captured_at,net_worth,cash_flow,safe_to_spend,financial_health_score,income,expenses,savings_rate,debt,currency_code',
  insights: 'id,user_id,type,title,summary,details,confidence,category,created_at',
} as const;

/** Table names, kept in one place. */
const TABLES = {
  snapshots: 'financial_snapshots',
  insights: 'financial_insights',
} as const;

/** Minimal shape of a PostgREST error, so no extra import is needed. */
interface QueryError {
  message: string;
}

/** Turn a PostgREST error into a clear exception, or return the rows. */
function asRows<T>(data: unknown, error: QueryError | null, label: string): T[] {
  if (error) {
    throw new Error(`Failed to load ${label} from Supabase: ${error.message}`);
  }
  return Array.isArray(data) ? (data as T[]) : [];
}

export class SupabaseIntelligenceRepository implements FinancialIntelligenceRepository {
  private readonly client: SupabaseClient;
  private readonly resolveUserId: () => Promise<string | null>;

  constructor(options: SupabaseIntelligenceRepositoryOptions) {
    this.client = options.client;
    this.resolveUserId = options.getUserId;
  }

  async loadSnapshots(limit: number): Promise<FinancialSnapshot[]> {
    const userId = await this.requireUserId();
    const { data, error } = await this.client
      .from(TABLES.snapshots)
      .select(COLUMNS.snapshots)
      .eq('user_id', userId)
      .order('captured_at', { ascending: false })
      .limit(boundedLimit(limit));
    return asRows<FinancialSnapshotRow>(data, error, 'financial snapshots').map(toAppFinancialSnapshot);
  }

  /**
   * Append one snapshot. `id` and `captured_at` are omitted so PostgreSQL
   * applies the Phase 3A column defaults (`gen_random_uuid()`, `now()`) — an
   * append-only capture is never rewritten.
   */
  async saveSnapshot(snapshot: NewFinancialSnapshot): Promise<void> {
    const userId = await this.requireUserId();
    const { error } = await this.client.from(TABLES.snapshots).insert(toFinancialSnapshotInsert(snapshot, userId));
    if (error) {
      throw new Error(`Failed to save the financial snapshot to Supabase: ${error.message}`);
    }
  }

  async loadInsights(limit: number): Promise<FinancialInsight[]> {
    const userId = await this.requireUserId();
    const { data, error } = await this.client
      .from(TABLES.insights)
      .select(COLUMNS.insights)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(boundedLimit(limit));
    return asRows<FinancialInsightRow>(data, error, 'financial insights').map(toAppFinancialInsight);
  }

  async saveInsight(insight: NewFinancialInsight): Promise<void> {
    const userId = await this.requireUserId();
    const { error } = await this.client.from(TABLES.insights).insert(toFinancialInsightInsert(insight, userId));
    if (error) {
      throw new Error(`Failed to save the financial insight to Supabase: ${error.message}`);
    }
  }

  async updateInsight(id: string, patch: Partial<NewFinancialInsight>): Promise<void> {
    const userId = await this.requireUserId();
    const payload = toFinancialInsightUpdate(patch);
    if (Object.keys(payload).length === 0) return;
    const { error } = await this.client.from(TABLES.insights).update(payload).eq('id', id).eq('user_id', userId);
    if (error) {
      throw new Error(`Failed to update the financial insight in Supabase: ${error.message}`);
    }
  }

  async deleteInsight(id: string): Promise<void> {
    const userId = await this.requireUserId();
    const { error } = await this.client.from(TABLES.insights).delete().eq('id', id).eq('user_id', userId);
    if (error) {
      throw new Error(`Failed to delete the financial insight in Supabase: ${error.message}`);
    }
  }

  /** Ownership comes from the verified session only — never a UI-supplied id. */
  private async requireUserId(): Promise<string> {
    const userId = await this.resolveUserId();
    if (userId === null) {
      throw new Error(
        'Cannot access intelligence data: there is no authenticated session. ' +
          'Row Level Security scopes every row to auth.uid().',
      );
    }
    return userId;
  }
}

/**
 * Build the intelligence repository from the client-safe configuration.
 * Returns null when Supabase is not configured, so the provider wiring can
 * fall back to `LocalStorageIntelligenceRepository` without the UI caring.
 */
export function createSupabaseIntelligenceRepository(
  client: SupabaseClient | null,
  options: Omit<SupabaseIntelligenceRepositoryOptions, 'client'>,
): SupabaseIntelligenceRepository | null {
  if (client === null) return null;
  return new SupabaseIntelligenceRepository({ client, ...options });
}
