import type { Account, Category, CurrencyCode, Transaction, TransactionType } from '../../types/financial';
import type { FinancialCoreState } from '../../services/financial/state';

/**
 * Derived selectors over the Financial Core state.
 *
 * Pages never filter/lookup financial data inline — they consume these pure
 * functions so all derivation stays centralized and testable.
 */

export function getAccountById(state: FinancialCoreState, id: string): Account | null {
  return state.accounts.find((account) => account.id === id) ?? null;
}

export function getCategoryById(state: FinancialCoreState, id: string | undefined): Category | null {
  if (!id) return null;
  return state.categories.find((category) => category.id === id) ?? null;
}

export function getCategoryName(state: FinancialCoreState, id: string | undefined): string {
  return getCategoryById(state, id)?.name ?? 'Uncategorized';
}

export function activeAccounts(state: FinancialCoreState): Account[] {
  return state.accounts.filter((account) => !account.isArchived);
}

/** Total of the account's own transactions (used by the account page). */
export function accountBalance(account: Account): number {
  return account.currentBalance;
}

/** Balance for a specific account id, safely. */
export function accountBalanceById(state: FinancialCoreState, id: string): number {
  return getAccountById(state, id)?.currentBalance ?? 0;
}

export function defaultCurrency(state: FinancialCoreState): CurrencyCode {
  return state.profile?.primaryCurrency ?? 'INR';
}

export function categoriesForType(state: FinancialCoreState, type: 'income' | 'expense'): Category[] {
  return state.categories
    .filter((category) => category.type === type && !category.isHidden)
    .sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

/** True when a transaction belongs to the source account of a transfer. */
export function isTransferSource(transaction: Transaction): boolean {
  return transaction.type === 'transfer';
}

/** Short human label for a transaction row: merchant · description · type. */
export function transactionTitle(transaction: Transaction): string {
  return transaction.merchant?.trim() || transaction.description?.trim() || transactionLabel(transaction.type);
}

export function transactionLabel(type: Transaction['type']): string {
  if (type === 'income') return 'Income';
  if (type === 'expense') return 'Expense';
  return 'Transfer';
}

export function recurringDisplayName(merchant?: string, description?: string, type: TransactionType = 'expense'): string {
  const name = merchant?.trim() || description?.trim() || transactionLabel(type);
  return name;
}