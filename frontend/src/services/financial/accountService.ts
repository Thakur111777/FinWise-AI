import { isSupportedCurrency } from '../../config/currencies';
import { fromMinorUnits, toMinorUnits } from '../../lib/money';
import type { Account, AccountType, CurrencyCode, Transaction } from '../../types/financial';
import { financialCoreStateWith, type FinancialCoreState } from './stateHelpers';
import { serviceFail, serviceOk, type FinancialResult } from './result';
import { createId } from './state';
import { parseNonNegativeAmount, parseOptionalText, parseText } from './validation';

/** Input contract for creating or editing an account. */
export interface AccountInput {
  name: string;
  type: AccountType;
  currencyCode: CurrencyCode;
  /** Opening balance the user enters today (>= 0). */
  initialBalance?: number;
  institutionName?: string;
}

export const ACCOUNT_TYPES: readonly { value: AccountType; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'checking', label: 'Checking' },
  { value: 'savings', label: 'Savings' },
  { value: 'creditCard', label: 'Credit Card' },
  { value: 'investment', label: 'Investment' },
  { value: 'other', label: 'Other' },
];

export function accountTypeLabel(type: AccountType): string {
  return ACCOUNT_TYPES.find((entry) => entry.value === type)?.label ?? type;
}

/**
 * Derive every account's current balance from `initialBalance` plus all
 * transaction effects using exact minor-unit math. Balances are always
 * recomputed from the full transaction set — effects can never be applied
 * twice because there is no incremental patch state.
 */
export function deriveAccountBalances(accounts: Account[], transactions: Transaction[]): Account[] {
  const balances = new Map<string, number>();
  for (const account of accounts) {
    balances.set(account.id, toMinorUnits(account.initialBalance));
  }

  for (const transaction of transactions) {
    const effect = toMinorUnits(transaction.amount);
    if (transaction.type === 'income') {
      const target = balances.get(transaction.accountId);
      if (target !== undefined) balances.set(transaction.accountId, target + effect);
    } else if (transaction.type === 'expense') {
      const target = balances.get(transaction.accountId);
      if (target !== undefined) balances.set(transaction.accountId, target - effect);
    } else if (transaction.type === 'transfer') {
      const source = balances.get(transaction.accountId);
      if (source !== undefined) balances.set(transaction.accountId, source - effect);
      if (transaction.toAccountId) {
        const destination = balances.get(transaction.toAccountId);
        if (destination !== undefined) balances.set(transaction.toAccountId, destination + effect);
      }
    }
  }

  return accounts.map((account) => ({
    ...account,
    currentBalance: fromMinorUnits(balances.get(account.id) ?? toMinorUnits(account.initialBalance)),
  }));
}

export function validateAccountInput(input: AccountInput, accounts: Account[]): string[] {
  const errors: string[] = [];
  const name = parseText(input.name);
  if (!name) {
    errors.push('Account name is required.');
  } else {
    const hasDuplicate = accounts.some((account) => account.name.trim().toLowerCase() === name.toLowerCase());
    if (hasDuplicate) errors.push('An account with this name already exists.');
  }
  if (!ACCOUNT_TYPES.some((entry) => entry.value === input.type)) errors.push('Account type is required.');
  if (!isSupportedCurrency(input.currencyCode)) errors.push('Select a valid currency.');

  const initialBalance = input.initialBalance === undefined ? 0 : input.initialBalance;
  if (parseNonNegativeAmount(initialBalance) === null) {
    errors.push('Opening balance must be zero or a positive number.');
  }
  return errors;
}
export function createAccount(
  state: FinancialCoreState,
  input: AccountInput,
  now: string = new Date().toISOString(),
): FinancialResult<{ state: FinancialCoreState; account: Account }> {
  const validationErrors = validateAccountInput(input, state.accounts);
  if (validationErrors.length > 0) {
    return serviceFail({ code: 'INVALID_ACCOUNT', message: validationErrors.join(' ') });
  }

  const initialBalance = parseNonNegativeAmount(input.initialBalance ?? 0)!;
  const account: Account = {
    id: createId('acct'),
    name: parseText(input.name)!,
    type: input.type,
    currencyCode: input.currencyCode,
    initialBalance,
    currentBalance: initialBalance,
    institutionName: parseOptionalText(input.institutionName),
    isArchived: false,
    createdAt: now,
    updatedAt: now,
  };

  const accounts = [...state.accounts, account];
  return serviceOk({ state: financialCoreStateWith(state, { accounts }), account });
}

export function updateAccount(
  state: FinancialCoreState,
  id: string,
  input: AccountInput,
  now: string = new Date().toISOString(),
): FinancialResult<{ state: FinancialCoreState; account: Account }> {
  const existing = state.accounts.find((account) => account.id === id);
  if (!existing) {
    return serviceFail({ code: 'NOT_FOUND', message: 'Account not found.', field: 'id' });
  }

  const others = state.accounts.filter((account) => account.id !== id);
  const validationErrors = validateAccountInput(input, others);
  if (validationErrors.length > 0) {
    return serviceFail({ code: 'INVALID_ACCOUNT', message: validationErrors.join(' ') });
  }

  const account: Account = {
    ...existing,
    name: parseText(input.name)!,
    type: input.type,
    currencyCode: input.currencyCode,
    initialBalance: parseNonNegativeAmount(input.initialBalance ?? existing.initialBalance)!,
    institutionName: parseOptionalText(input.institutionName),
    updatedAt: now,
  };

  const accounts = deriveAccountBalances(
    state.accounts.map((item) => (item.id === id ? account : item)),
    state.transactions,
  );
  const derived = accounts.find((item) => item.id === id)!;
  return serviceOk({ state: financialCoreStateWith(state, { accounts }), account: derived });
}

export function archiveAccount(
  state: FinancialCoreState,
  id: string,
  now: string = new Date().toISOString(),
): FinancialResult<{ state: FinancialCoreState; account: Account }> {
  return setAccountArchived(state, id, true, now);
}

/**
 * Permanently delete an account.
 *
 * SAFETY: Accounts referenced by transactions cannot be deleted because the
 * database schema uses `ON DELETE RESTRICT` on the transactions.account_id
 * foreign key (see supabase/migrations/20260915090000_phase3a_initial_schema.sql
 * line 256). This service-layer check provides a clear, human-readable error
 * message before the database rejects the operation.
 */
export function deleteAccount(
  state: FinancialCoreState,
  id: string,
): FinancialResult<{ state: FinancialCoreState }> {
  const existing = state.accounts.find((account) => account.id === id);
  if (!existing) {
    return serviceFail({ code: 'NOT_FOUND', message: 'Account not found.', field: 'id' });
  }

  // Only archived accounts can be permanently deleted.
  if (!existing.isArchived) {
    return serviceFail({
      code: 'ACCOUNT_NOT_ARCHIVED',
      message: 'Only archived accounts can be permanently deleted. Archive the account first.',
      field: 'id',
    });
  }

  // Check if the account has any transactions.
  const transactionCount = state.transactions.filter(
    (transaction) => transaction.accountId === id,
  ).length;

  if (transactionCount > 0) {
    return serviceFail({
      code: 'ACCOUNT_HAS_TRANSACTIONS',
      message: `Cannot delete this account because it has ${transactionCount} transaction(s) linked to it. Delete or move those transactions first, or keep the account archived.`,
      field: 'id',
    });
  }

  const accounts = state.accounts.filter((account) => account.id !== id);
  return serviceOk({ state: financialCoreStateWith(state, { accounts }) });
}

export function unarchiveAccount(
  state: FinancialCoreState,
  id: string,
  now: string = new Date().toISOString(),
): FinancialResult<{ state: FinancialCoreState; account: Account }> {
  return setAccountArchived(state, id, false, now);
}

function setAccountArchived(
  state: FinancialCoreState,
  id: string,
  isArchived: boolean,
  now: string,
): FinancialResult<{ state: FinancialCoreState; account: Account }> {
  const existing = state.accounts.find((account) => account.id === id);
  if (!existing) {
    return serviceFail({ code: 'NOT_FOUND', message: 'Account not found.', field: 'id' });
  }
  if (existing.isArchived === isArchived) {
    return serviceOk({ state, account: existing });
  }
  const account = { ...existing, isArchived, updatedAt: now };
  const accounts = state.accounts.map((item) => (item.id === id ? account : item));
  return serviceOk({ state: financialCoreStateWith(state, { accounts }), account });
}