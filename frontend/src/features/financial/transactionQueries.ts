import type { Transaction, TransactionType } from '../../types/financial';

/**
 * Pure search / filter / sort for the transaction list.
 *
 * Kept separate from the UI so the same logic can be reused by pages,
 * future analytics, and tests.
 */

export interface TransactionFilters {
  /** Empty array means "all transaction types". */
  types: TransactionType[];
  accountId?: string;
  categoryId?: string;
  dateFrom?: string;
  dateTo?: string;
  /** Case-insensitive match against merchant, description, and notes. */
  search?: string;
}

export type TransactionSort = 'newest' | 'oldest' | 'highest' | 'lowest';

export const ALL_TRANSACTION_TYPES: readonly TransactionType[] = ['income', 'expense', 'transfer'];

export function matchesSearch(transaction: Transaction, query: string): boolean {
  const term = query.trim().toLowerCase();
  if (term.length === 0) return true;
  const haystack = [transaction.merchant, transaction.description, transaction.notes]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(term);
}

export function filterTransactions(transactions: Transaction[], filters: TransactionFilters): Transaction[] {
  return transactions.filter((transaction) => {
    if (filters.types && filters.types.length > 0 && !filters.types.includes(transaction.type)) return false;
    if (filters.accountId && transaction.accountId !== filters.accountId && transaction.toAccountId !== filters.accountId) {
      return false;
    }
    if (filters.categoryId && transaction.categoryId !== filters.categoryId) return false;
    if (filters.dateFrom && transaction.date < filters.dateFrom) return false;
    if (filters.dateTo && transaction.date > filters.dateTo) return false;
    if (filters.search !== undefined && !matchesSearch(transaction, filters.search)) return false;
    return true;
  });
}

export function sortTransactions(transactions: Transaction[], sort: TransactionSort): Transaction[] {
  const sorted = [...transactions];
  if (sort === 'newest') {
    return sorted.sort((a, b) => (a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date)));
  }
  if (sort === 'oldest') {
    return sorted.sort((a, b) => (a.date === b.date ? a.createdAt.localeCompare(b.createdAt) : a.date.localeCompare(b.date)));
  }
  if (sort === 'highest') {
    return sorted.sort((a, b) => b.amount - a.amount);
  }
  return sorted.sort((a, b) => a.amount - b.amount);
}

/** Deterministic signed effect of a transaction on its source account. */
export function transactionEffectOnSource(transaction: Transaction): number {
  if (transaction.type === 'income') return transaction.amount;
  if (transaction.type === 'expense') return -transaction.amount;
  return -transaction.amount; // transfer leaves the source account
}

/** Deterministic signed effect of a transaction on its destination account. */
export function transactionEffectOnDestination(transaction: Transaction): number {
  if (transaction.type === 'transfer') return transaction.amount;
  return 0;
}