import type {
  Account,
  Budget,
  Category,
  Goal,
  RecurringTransaction,
  Transaction,
  UserProfile,
} from '../../types/financial';

/**
 * Persistence boundary of the Financial Core.
 *
 * The UI talks to a `FinancialRepository` — never to browser storage
 * directly. Phase 2 ships `LocalStorageRepository`; a future
 * `SupabaseRepository` can implement the same interface and replace it
 * without touching a single page.
 *
 * All write methods are upsert-style: pass the full updated collection and
 * the repository persists it atomically per collection.
 */
export interface FinancialRepository {
  /** Load every persisted collection, failing safe on corrupted data. */
  load(): Promise<StoredFinancialState>;
  saveProfile(profile: UserProfile | null): Promise<void>;
  saveAccounts(accounts: Account[]): Promise<void>;
  saveCategories(categories: Category[]): Promise<void>;
  saveTransactions(transactions: Transaction[]): Promise<void>;
  saveRecurringTransactions(items: RecurringTransaction[]): Promise<void>;
  saveBudgets(budgets: Budget[]): Promise<void>;
  saveGoals(goals: Goal[]): Promise<void>;
}

/** Everything the repository can return after a load. */
export interface StoredFinancialState {
  profile: UserProfile | null;
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  recurringTransactions: RecurringTransaction[];
  budgets: Budget[];
  goals: Goal[];
}

export function createEmptyStoredState(): StoredFinancialState {
  return {
    profile: null,
    accounts: [],
    categories: [],
    transactions: [],
    recurringTransactions: [],
    budgets: [],
    goals: [],
  };
}