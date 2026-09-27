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
 * Single source of truth for the Financial Core.
 *
 * Pages and hooks consume this state through the FinancialDataProvider and
 * never own independent copies of financial data. Mutations are applied by
 * pure services that always return a fresh state object.
 */
export interface FinancialCoreState {
  profile: UserProfile | null;
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  budgets: Budget[];
  goals: Goal[];
  recurringTransactions: RecurringTransaction[];
}

export function createEmptyState(): FinancialCoreState {
  return {
    profile: null,
    accounts: [],
    categories: [],
    transactions: [],
    budgets: [],
    goals: [],
    recurringTransactions: [],
  };
}

/** Stable unique id helper used across the Core (collision-safe via UUID v4). */
export function createId(prefix: string): string {
  const uuid = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${uuid}`;
}