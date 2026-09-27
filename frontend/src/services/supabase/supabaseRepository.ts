import type { SupabaseClient } from '@supabase/supabase-js';
import { deriveAccountBalances } from '../financial/accountService';
import { withDerivedBudgetSpending } from '../financial/budgetService';
import { createEmptyStoredState, type FinancialRepository, type StoredFinancialState } from '../financial/repository';
import type { Account, Budget, Category, Goal, RecurringTransaction, Transaction, UserProfile } from '../../types/financial';
import type {
  AccountRow,
  BudgetRow,
  CategoryRow,
  GoalRow,
  ProfileRow,
  RecurringTransactionRow,
  TransactionRow,
} from './database.types';
import {
  isUuid,
  toAccountInsert,
  toAppAccount,
  toAppBudget,
  toAppCategory,
  toAppGoal,
  toAppProfile,
  toAppRecurringTransaction,
  toAppTransaction,
  toBudgetInsert,
  toCategoryInsert,
  toGoalInsert,
  toProfileUpsert,
  toRecurringTransactionInsert,
  toTransactionInsert,
} from './mappers';

/**
 * Supabase-backed `FinancialRepository` — the production persistence layer for
 * authenticated FinWise users (wired in Phase 3B).
 *
 * LOCKED ARCHITECTURE
 *
 *   React Frontend -> FinWise Backend / secure server boundary
 *                  -> Supabase (Auth + PostgreSQL) -> Row Level Security
 *
 * This class is the *frontend* half of that boundary. It holds only the public
 * anon key, and every statement it issues is additionally constrained by the
 * Row Level Security policies in
 * supabase/migrations/20260915090000_phase3a_initial_schema.sql. It never
 * carries the service-role key and never bypasses RLS.
 *
 * STATUS (Phase 3B): live. `FinancialDataProvider` selects this repository
 * whenever Supabase is configured and a session exists, so authenticated users
 * persist to PostgreSQL. `LocalStorageRepository` remains only the deliberate
 * fallback for an unconfigured environment, where no user can ever be signed in
 * — there is no dual persistence for the same user.
 *
 * The repository never trusts a user id supplied by the UI: ownership comes from
 * the resolved session, and RLS is the authoritative check on every statement.
 *
 * DERIVE, NEVER DOUBLE-APPLY
 * Money that the domain derives is re-derived here rather than trusted:
 *   * `accounts.current_balance`  <- deriveAccountBalances() on load
 *   * `budgets.spent`             <- withDerivedBudgetSpending() on load
 * So a stored value can never be applied twice, exactly like the local path.
 */

/** How the repository learns who the current user is. */
export interface SupabaseRepositoryOptions {
  /** A client built from the public anon key only. */
  client: SupabaseClient;
  /**
   * Resolve the authenticated user id (`auth.uid()`), or null when signed out.
   * Defaults to reading the real Supabase Auth session.
   */
  getUserId?: () => Promise<string | null>;
  /**
   * Resolve the authoritative authentication email (`auth.users.email`).
   * Defaults to reading the real Supabase Auth session.
   */
  getEmail?: () => Promise<string | null>;
}

/** PostgREST column list for each collection, kept in one place. */
const COLUMNS = {
  profile: 'id,name,primary_currency,locale,timezone,role,pay_frequency,monthly_income_expectation,financial_preferences,created_at,updated_at',
  accounts: 'id,user_id,name,type,currency_code,initial_balance,current_balance,institution_name,is_archived,created_at,updated_at',
  categories: 'id,user_id,name,type,is_default,is_hidden,created_at',
  transactions:
    'id,user_id,account_id,to_account_id,type,amount,currency_code,category_id,merchant,description,date,notes,is_recurring,recurring_transaction_id,created_at,updated_at',
  recurringTransactions:
    'id,user_id,account_id,to_account_id,type,amount,currency_code,category_id,merchant,description,frequency,start_date,end_date,next_occurrence_at,is_active,created_at,updated_at',
  budgets: 'id,user_id,category_id,currency_code,limit_amount,spent,period,start_date,end_date,created_at',
  goals: 'id,user_id,title,target_amount,current_amount,currency_code,target_date,category_id,status,created_at',
} as const;

/** Table names, kept in one place so they can never drift between calls. */
const TABLES = {
  profiles: 'profiles',
  accounts: 'accounts',
  categories: 'categories',
  transactions: 'transactions',
  recurringTransactions: 'recurring_transactions',
  budgets: 'budgets',
  goals: 'goals',
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

/** Collect the ids of a collection in a stable order. */
function collectionIds(rows: readonly { id: string }[]): string[] {
  return rows.map((row) => row.id);
}

export class SupabaseRepository implements FinancialRepository {
  private readonly client: SupabaseClient;
  private readonly resolveUserId: () => Promise<string | null>;
  private readonly resolveEmail: () => Promise<string | null>;

  constructor(options: SupabaseRepositoryOptions) {
    this.client = options.client;
    this.resolveUserId = options.getUserId ?? (() => readSessionUserId(this.client));
    this.resolveEmail = options.getEmail ?? (() => readSessionEmail(this.client));
  }

  /* ------------------------------- loading ------------------------------- */

  /**
   * Load every collection for the signed-in user.
   *
   * A missing session yields an honest empty state — RLS would return nothing
   * anyway — so a Phase 3A app that is not yet signing users in behaves like a
   * fresh profile instead of crashing.
   */
  async load(): Promise<StoredFinancialState> {
    const state = createEmptyStoredState();
    const userId = await this.resolveUserId();
    if (userId === null) return state;

    const [profile, accounts, categories, transactions, recurring, budgets, goals] =
      await Promise.all([
        this.client.from(TABLES.profiles).select(COLUMNS.profile).eq('id', userId).maybeSingle(),
        this.client
          .from(TABLES.accounts)
          .select(COLUMNS.accounts)
          .eq('user_id', userId)
          .order('created_at', { ascending: true }),
        this.client
          .from(TABLES.categories)
          .select(COLUMNS.categories)
          .eq('user_id', userId)
          .order('type', { ascending: true })
          .order('name', { ascending: true }),
        this.client
          .from(TABLES.transactions)
          .select(COLUMNS.transactions)
          .eq('user_id', userId)
          .order('date', { ascending: true })
          .order('created_at', { ascending: true }),
        this.client
          .from(TABLES.recurringTransactions)
          .select(COLUMNS.recurringTransactions)
          .eq('user_id', userId)
          .order('next_occurrence_at', { ascending: true }),
        this.client
          .from(TABLES.budgets)
          .select(COLUMNS.budgets)
          .eq('user_id', userId)
          .order('start_date', { ascending: true }),
        this.client
          .from(TABLES.goals)
          .select(COLUMNS.goals)
          .eq('user_id', userId)
          .order('created_at', { ascending: true }),
      ]);

    const profileRow = readProfileRow(profile.data, profile.error);
    if (profileRow !== null) {
      const email = (await this.resolveEmail()) ?? '';
      state.profile = toAppProfile(profileRow, email);
    }

    const accountRows = asRows<AccountRow>(accounts.data, accounts.error, 'accounts');
    const transactionRows = asRows<TransactionRow>(
      transactions.data,
      transactions.error,
      'transactions',
    );
    const categoryRows = asRows<CategoryRow>(categories.data, categories.error, 'categories');
    const recurringRows = asRows<RecurringTransactionRow>(
      recurring.data,
      recurring.error,
      'recurring transactions',
    );
    const budgetRows = asRows<BudgetRow>(budgets.data, budgets.error, 'budgets');
    const goalRows = asRows<GoalRow>(goals.data, goals.error, 'goals');

    state.categories = categoryRows.map(toAppCategory);
    state.transactions = transactionRows.map(toAppTransaction);
    state.recurringTransactions = recurringRows.map(toAppRecurringTransaction);
    state.goals = goalRows.map(toAppGoal);

    // Derived money is re-derived from the authoritative inputs, never trusted
    // as stored, so one effect can never be applied twice.
    state.accounts = deriveAccountBalances(accountRows.map(toAppAccount), state.transactions);
    state.budgets = withDerivedBudgetSpending(budgetRows.map(toAppBudget), state.transactions);

    return state;
  }

  /* ------------------------------- writing ------------------------------- */

  async saveProfile(profile: UserProfile | null): Promise<void> {
    if (profile === null) {
      // Deleting a profile is part of deleting the auth user, which cascades
      // from auth.users. It is not an action the Financial Core performs, and
      // profiles deliberately has no DELETE RLS policy.
      return;
    }
    const userId = await this.requireUserId();
    const { error } = await this.client
      .from(TABLES.profiles)
      .upsert(toProfileUpsert({ ...profile, id: userId }), { onConflict: 'id' });
    if (error) {
      throw new Error(`Failed to save the profile to Supabase: ${error.message}`);
    }
  }

  /**
   * Upsert accounts, then reconcile deletions.
   *
   * Accounts referenced by transactions cannot be deleted (the schema uses
   * `ON DELETE RESTRICT` on transactions.account_id, and the Financial Core's
   * service layer blocks such deletes before this method is ever called), so
   * pruning rows the user permanently deleted is safe here. Without this
   * reconciliation a permanently deleted archived account would survive in
   * PostgreSQL and reappear on every subsequent load.
   */
  async saveAccounts(accounts: Account[]): Promise<void> {
    const userId = await this.requireUserId();
    await this.upsertRows(
      TABLES.accounts,
      accounts.map((account) => toAccountInsert(account, userId)),
      'id',
      'accounts',
    );
    await this.reconcileDeletions(TABLES.accounts, userId, collectionIds(accounts), 'accounts');
  }

  /**
   * Upsert categories.
   *
   * Categories are hidden, never deleted, by the Financial Core — history must
   * never point at a vanished category — so there is no deletion
   * reconciliation here either. Rows are matched by the natural key
   * (user_id, type, name), which also lets a Phase 2 slug id be adopted once
   * without creating a duplicate of a trigger-seeded default.
   */
  async saveCategories(categories: Category[]): Promise<void> {
    const userId = await this.requireUserId();
    const payloads = categories.map((category) => toCategoryInsert(category, userId));
    await this.upsertRows(TABLES.categories, payloads, 'user_id,type,name', 'categories');
  }

  async saveTransactions(transactions: Transaction[]): Promise<void> {
    const userId = await this.requireUserId();
    await this.upsertRows(
      TABLES.transactions,
      transactions.map((transaction) => toTransactionInsert(transaction, userId)),
      'id',
      'transactions',
    );
    await this.reconcileDeletions(
      TABLES.transactions,
      userId,
      collectionIds(transactions),
      'transactions',
    );
  }

  async saveRecurringTransactions(items: RecurringTransaction[]): Promise<void> {
    const userId = await this.requireUserId();
    await this.upsertRows(
      TABLES.recurringTransactions,
      items.map((item) => toRecurringTransactionInsert(item, userId)),
      'id',
      'recurring transactions',
    );
    await this.reconcileDeletions(
      TABLES.recurringTransactions,
      userId,
      collectionIds(items),
      'recurring transactions',
    );
  }

  async saveBudgets(budgets: Budget[]): Promise<void> {
    const userId = await this.requireUserId();
    await this.upsertRows(
      TABLES.budgets,
      budgets.map((budget) => toBudgetInsert(budget, userId)),
      'id',
      'budgets',
    );
    await this.reconcileDeletions(TABLES.budgets, userId, collectionIds(budgets), 'budgets');
  }

  async saveGoals(goals: Goal[]): Promise<void> {
    const userId = await this.requireUserId();
    await this.upsertRows(
      TABLES.goals,
      goals.map((goal) => toGoalInsert(goal, userId)),
      'id',
      'goals',
    );
    await this.reconcileDeletions(TABLES.goals, userId, collectionIds(goals), 'goals');
  }

  /* ------------------------------ internals ------------------------------ */

  private async requireUserId(): Promise<string> {
    const userId = await this.resolveUserId();
    if (userId === null) {
      throw new Error(
        'Cannot write to Supabase: there is no authenticated session. ' +
          'Row Level Security scopes every row to auth.uid().',
      );
    }
    return userId;
  }

  private async upsertRows(
    table: string,
    rows: readonly object[],
    onConflict: string,
    label: string,
  ): Promise<void> {
    if (rows.length === 0) return;
    // `defaultToNull: false` sends `Prefer: missing=default`, and it is required
    // for correctness here, not cosmetic.
    //
    // A bulk upsert makes postgrest-js send `?columns=` = the union of every
    // row's own keys, and PostgREST's default behaviour is to write NULL for a
    // listed column that a particular row does not carry. Phase 2 mints prefixed
    // application ids (`acct-…`, `txn-…`, `cat-…`), which are deliberately not
    // sent as uuid primary keys (see uuidColumn in mappers.ts), so `id` is
    // absent from those rows. Without this option `id` would still be listed —
    // because a sibling row or the new row's own key set contributes it — and
    // PostgreSQL would receive NULL, violating the NOT NULL constraint instead
    // of running the Phase 3A column default `gen_random_uuid()`.
    const { error } = await this.client
      .from(table)
      .upsert([...rows], { onConflict, defaultToNull: false });
    if (error) {
      throw new Error(`Failed to save ${label} to Supabase: ${error.message}`);
    }
  }

  /**
   * Delete rows of a collection that are no longer present.
   *
   * Two guards keep this from ever destroying data by accident:
   *
   *  * an empty collection is never pruned — an empty collection is far more
   *    likely to be a partial or failed load than a request to erase everything
   *  * pruning is skipped when any id is not a database uuid, because such rows
   *    were inserted without an id (Phase 2 mints `txn-<uuid>` style ids) and
   *    their real database ids are therefore unknown
   */
  private async reconcileDeletions(
    table: string,
    userId: string,
    appIds: readonly string[],
    label: string,
  ): Promise<void> {
    if (appIds.length === 0) return;
    if (!appIds.every(isUuid)) return;

    const { error } = await this.client
      .from(table)
      .delete()
      .eq('user_id', userId)
      .not('id', 'in', `(${appIds.join(',')})`);
    if (error) {
      throw new Error(`Failed to reconcile deleted ${label} in Supabase: ${error.message}`);
    }
  }
}

/** Read `auth.users.id` from the real Supabase Auth session. */
async function readSessionUserId(client: SupabaseClient): Promise<string | null> {
  const { data, error } = await client.auth.getUser();
  if (error) return null;
  return data.user?.id ?? null;
}

/** Read the authoritative authentication email from Supabase Auth. */
async function readSessionEmail(client: SupabaseClient): Promise<string | null> {
  const { data, error } = await client.auth.getUser();
  if (error) return null;
  return data.user?.email ?? null;
}

/** `maybeSingle()` returns an object or null; surface a real error loudly. */
function readProfileRow(data: unknown, error: QueryError | null): ProfileRow | null {
  if (error) {
    throw new Error(`Failed to load the profile from Supabase: ${error.message}`);
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
  return data as ProfileRow;
}

/**
 * Build the repository from the client-safe configuration.
 *
 * Returns null when Supabase is not configured (or when no client was
 * supplied), so Phase 3B can fall back to `LocalStorageRepository` without a
 * single page needing to know which one it got.
 */
export function createSupabaseRepository(
  client: SupabaseClient | null,
  options: Omit<SupabaseRepositoryOptions, 'client'> = {},
): SupabaseRepository | null {
  if (client === null) return null;
  return new SupabaseRepository({ client, ...options });
}