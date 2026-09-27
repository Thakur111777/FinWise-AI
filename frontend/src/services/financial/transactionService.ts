import { roundMoney } from '../../lib/money';
import type { CurrencyCode, Transaction, TransactionType } from '../../types/financial';
import { deriveAccountBalances } from './accountService';
import { financialCoreStateWith, type FinancialCoreState } from './stateHelpers';
import { serviceFail, serviceOk, type FinancialResult } from './result';
import { createId } from './state';
import { parseAmount, parseDate, parseOptionalText } from './validation';

/** Input contract for creating or editing a transaction. */
export interface TransactionInput {
  accountId: string;
  /** Transfers only — destination account. */
  toAccountId?: string | null;
  type: TransactionType;
  amount: number;
  currencyCode: CurrencyCode;
  /** Income/expense transactions must reference an existing matching category. */
  categoryId?: string | null;
  merchant?: string | null;
  description?: string | null;
  /** Occurrence date (YYYY-MM-DD). */
  date: string;
  notes?: string | null;
  isRecurring: boolean;
  recurringTransactionId?: string | null;
}

/**
 * Validate a transaction against the current financial state. Returns
 * human-readable, field-agnostic errors the UI can surface as-is.
 */
export function validateTransactionInput(input: TransactionInput, state: FinancialCoreState): string[] {
  const errors: string[] = [];

  if (parseAmount(input.amount) === null) errors.push('Amount must be a positive number.');

  if (input.type !== 'income' && input.type !== 'expense' && input.type !== 'transfer') {
    errors.push('Choose a transaction type.');
  }

  const account = state.accounts.find((item) => item.id === input.accountId);
  if (!account) {
    errors.push('Choose a valid account.');
  } else if (account.isArchived) {
    errors.push('This account is archived. Unarchive it before adding transactions.');
  } else if (account.currencyCode !== input.currencyCode) {
    errors.push(`Amount currency must match the account currency (${account.currencyCode}).`);
  }

  if (input.type === 'transfer') {
    if (!input.toAccountId) {
      errors.push('Choose a destination account for the transfer.');
    } else if (input.toAccountId === input.accountId) {
      errors.push('The destination account must be different from the source account.');
    } else {
      const destination = state.accounts.find((item) => item.id === input.toAccountId);
      if (!destination) {
        errors.push('Choose a valid destination account.');
      } else if (destination.isArchived) {
        errors.push('The destination account is archived.');
      } else if (destination.currencyCode !== input.currencyCode) {
        errors.push(`Destination account currency (${destination.currencyCode}) must match the transfer currency.`);
      }
    }
  }

  if (input.type === 'income' || input.type === 'expense') {
    if (!input.categoryId) {
      errors.push('Choose a category.');
    } else {
      const category = state.categories.find((item) => item.id === input.categoryId);
      if (!category) {
        errors.push('Choose a valid category.');
      } else if (category.type !== input.type) {
        errors.push(`Category "${category.name}" is an ${category.type} category — pick an ${input.type} one.`);
      }
    }
  }

  if (!parseDate(input.date)) {
    errors.push('Choose a valid date (YYYY-MM-DD).');
  }

  return errors;
}

/** Build a validated Transaction from an input (internal). */
function buildTransaction(
  input: TransactionInput,
  now: string,
  id: string,
  createdAt: string,
): Transaction {
  return {
    id,
    accountId: input.accountId,
    toAccountId: input.type === 'transfer' ? parseOptionalText(input.toAccountId) : undefined,
    type: input.type,
    amount: roundMoney(input.amount),
    currencyCode: input.currencyCode,
    categoryId: input.type === 'transfer' ? undefined : parseOptionalText(input.categoryId),
    merchant: parseOptionalText(input.merchant),
    description: parseOptionalText(input.description),
    date: input.date,
    notes: parseOptionalText(input.notes),
    isRecurring: input.isRecurring,
    recurringTransactionId: parseOptionalText(input.recurringTransactionId),
    createdAt,
    updatedAt: now,
  };
}

export function updateTransaction(
  state: FinancialCoreState,
  id: string,
  input: TransactionInput,
  now: string = new Date().toISOString(),
): FinancialResult<{ state: FinancialCoreState; transaction: Transaction }> {
  const existing = state.transactions.find((transaction) => transaction.id === id);
  if (!existing) {
    return serviceFail({ code: 'NOT_FOUND', message: 'Transaction not found.', field: 'id' });
  }

  const validationErrors = validateTransactionInput(input, state);
  if (validationErrors.length > 0) {
    return serviceFail({ code: 'INVALID_TRANSACTION', message: validationErrors.join(' ') });
  }

  const transaction = buildTransaction(input, now, id, existing.createdAt);
  const transactions = state.transactions.map((item) => (item.id === id ? transaction : item));
  const accounts = deriveAccountBalances(state.accounts, transactions);
  return serviceOk({
    state: financialCoreStateWith(state, { transactions, accounts }),
    transaction,
  });
}

/**
 * Remove a transaction. The old financial impact is reversed implicitly
 * because account balances are re-derived from the full transaction set —
 * there is no incremental balance to unwrite, so this can never double-count.
 */
export function deleteTransaction(
  state: FinancialCoreState,
  id: string,
): FinancialResult<{ state: FinancialCoreState }> {
  const existing = state.transactions.find((transaction) => transaction.id === id);
  if (!existing) {
    return serviceFail({ code: 'NOT_FOUND', message: 'Transaction not found.', field: 'id' });
  }

  const transactions = state.transactions.filter((item) => item.id !== id);
  const accounts = deriveAccountBalances(state.accounts, transactions);
  return serviceOk({ state: financialCoreStateWith(state, { transactions, accounts }) });
}

export function createTransaction(
  state: FinancialCoreState,
  input: TransactionInput,
  now: string = new Date().toISOString(),
): FinancialResult<{ state: FinancialCoreState; transaction: Transaction }> {
  const validationErrors = validateTransactionInput(input, state);
  if (validationErrors.length > 0) {
    return serviceFail({ code: 'INVALID_TRANSACTION', message: validationErrors.join(' ') });
  }

  const transaction = buildTransaction(input, now, createId('txn'), now);
  const transactions = [...state.transactions, transaction];
  const accounts = deriveAccountBalances(state.accounts, transactions);
  return serviceOk({
    state: financialCoreStateWith(state, { transactions, accounts }),
    transaction,
  });
}