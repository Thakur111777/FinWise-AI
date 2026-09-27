import { createContext } from 'react';
import type { FinancialCoreState } from '../../services/financial/state';
import type { AccountInput } from '../../services/financial/accountService';
import type { BudgetInput } from '../../services/financial/budgetService';
import type { CategoryInput } from '../../services/financial/categoryService';
import type { GoalInput } from '../../services/financial/goalService';
import type { ProfileInput } from '../../services/financial/profileService';
import type { RecurringInput } from '../../services/financial/recurringService';
import type { TransactionInput } from '../../services/financial/transactionService';

/**
 * Shared context core for the Financial Data store.
 *
 * Split from the provider component and the consuming hooks so the
 * react-refresh rule (components-only exports) stays clean. Pages consume
 * state through this context and mutate it exclusively through `actions` —
 * the UI never owns financial state itself.
 */
export type FinancialDataState = FinancialCoreState;

export interface FinancialDataActions {
  saveProfile(input: ProfileInput): Promise<void>;
  createAccount(input: AccountInput): Promise<void>;
  updateAccount(id: string, input: AccountInput): Promise<void>;
  archiveAccount(id: string): Promise<void>;
  unarchiveAccount(id: string): Promise<void>;
  deleteAccount(id: string): Promise<void>;
  createCategory(input: CategoryInput): Promise<void>;
  updateCategory(id: string, input: CategoryInput): Promise<void>;
  addTransaction(input: TransactionInput, recurringSchedule?: RecurringInput): Promise<void>;
  updateTransaction(id: string, input: TransactionInput): Promise<void>;
  deleteTransaction(id: string): Promise<void>;
  createRecurring(input: RecurringInput): Promise<void>;
  updateRecurring(id: string, input: RecurringInput): Promise<void>;
  deleteRecurring(id: string): Promise<void>;
  toggleRecurringActive(id: string, isActive: boolean): Promise<void>;
  createBudget(input: BudgetInput): Promise<void>;
  updateBudget(id: string, input: BudgetInput): Promise<void>;
  deleteBudget(id: string): Promise<void>;
  createGoal(input: GoalInput): Promise<void>;
  updateGoal(id: string, input: GoalInput): Promise<void>;
  deleteGoal(id: string): Promise<void>;
}

export interface FinancialDataContextValue extends FinancialDataState {
  /** Becomes true once the repository has loaded and hydrated the store. */
  isHydrated: boolean;
  /**
   * Message of the most recent failed action (load or mutation), surfaced by
   * the app shell banner so persistence failures are never silent. Forms
   * additionally render the same error inline.
   */
  lastError: string | null;
  /** Dismiss the surfaced error message. */
  clearLastError(): void;
  actions: FinancialDataActions;
}

export const FinancialDataContext = createContext<FinancialDataContextValue | null>(null);