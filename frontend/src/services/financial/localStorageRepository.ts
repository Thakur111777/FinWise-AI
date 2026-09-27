import type {
  Account,
  Budget,
  Category,
  Goal,
  RecurringTransaction,
  Transaction,
  UserProfile,
} from '../../types/financial';
import {
  parseStoredAccount,
  parseStoredArray,
  parseStoredBudget,
  parseStoredCategory,
  parseStoredGoal,
  parseStoredProfile,
  parseStoredRecurring,
  parseStoredTransaction,
} from './validation';
import type { FinancialRepository, StoredFinancialState } from './repository';
import { createEmptyStoredState } from './repository';

/**
 * Minimal Storage contract so the repository works in the browser
 * (localStorage), in tests (in-memory stub), and later behind a
 * Supabase-backed repository.
 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

const KEYS = {
  profile: 'finwise.profile.v2',
  accounts: 'finwise.accounts.v2',
  categories: 'finwise.categories.v2',
  transactions: 'finwise.transactions.v2',
  recurring: 'finwise.recurring.v2',
  budgets: 'finwise.budgets.v2',
  goals: 'finwise.goals.v2',
} as const;

/**
 * Local persistence for the Financial Core (Phase 2).
 *
 * - Every read is defensive: corrupted JSON or malformed entities degrade to
 *   a safe empty state instead of crashing the app.
 * - Every mutation is persisted write-through to browser storage.
 * - The storage key version suffix (`v2`) is the escape hatch for future
 *   schema migrations.
 */
export class LocalStorageRepository implements FinancialRepository {
  private readonly storage: StorageLike | null;

  constructor(storage: StorageLike | null = typeof localStorage !== 'undefined' ? localStorage : null) {
    this.storage = storage;
  }

  async load(): Promise<StoredFinancialState> {
    const stored = createEmptyStoredState();
    const storedProfile = this.readRaw(KEYS.profile);
    if (storedProfile !== null) {
      stored.profile = parseStoredProfile(this.parse(storedProfile));
    }
    stored.accounts = this.readCollection(KEYS.accounts, parseStoredAccount);
    stored.categories = this.readCollection(KEYS.categories, parseStoredCategory);
    stored.transactions = this.readCollection(KEYS.transactions, parseStoredTransaction);
    stored.recurringTransactions = this.readCollection(KEYS.recurring, parseStoredRecurring);
    stored.budgets = this.readCollection(KEYS.budgets, parseStoredBudget);
    stored.goals = this.readCollection(KEYS.goals, parseStoredGoal);
    return stored;
  }

  async saveProfile(profile: UserProfile | null): Promise<void> {
    this.write(KEYS.profile, profile);
  }

  async saveAccounts(accounts: Account[]): Promise<void> {
    this.write(KEYS.accounts, accounts);
  }

  async saveCategories(categories: Category[]): Promise<void> {
    this.write(KEYS.categories, categories);
  }

  async saveTransactions(transactions: Transaction[]): Promise<void> {
    this.write(KEYS.transactions, transactions);
  }

  async saveRecurringTransactions(items: RecurringTransaction[]): Promise<void> {
    this.write(KEYS.recurring, items);
  }

  async saveBudgets(budgets: Budget[]): Promise<void> {
    this.write(KEYS.budgets, budgets);
  }

  async saveGoals(goals: Goal[]): Promise<void> {
    this.write(KEYS.goals, goals);
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

  private readCollection<T>(key: string, parser: (item: unknown) => T | null): T[] {
    const raw = this.readRaw(key);
    if (raw === null) return [];
    return parseStoredArray(this.parse(raw), parser);
  }

  private write(key: string, value: unknown): void {
    if (!this.storage) return;
    try {
      if (value === null) {
        this.storage.removeItem?.(key);
        return;
      }
      this.storage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage full/unavailable — the in-memory state stays authoritative,
      // persistence failures never crash the app.
    }
  }
}