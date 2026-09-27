import { addDays, addMonthsClamped, addYears, isValidISODate, todayISODate } from '../../lib/date';
import { roundMoney } from '../../lib/money';
import type {
  CurrencyCode,
  RecurrenceFrequency,
  RecurringTransaction,
  TransactionType,
} from '../../types/financial';
import { financialCoreStateWith, type FinancialCoreState } from './stateHelpers';
import { serviceFail, serviceOk, type FinancialResult } from './result';
import { createId } from './state';
import { parseAmount, parseDate, parseFrequency, parseOptionalDate, parseOptionalText } from './validation';

/** Input contract for creating or editing a recurring transaction. */
export interface RecurringInput {
  accountId: string;
  toAccountId?: string | null;
  type: TransactionType;
  amount: number;
  currencyCode: CurrencyCode;
  categoryId?: string | null;
  merchant?: string | null;
  description?: string | null;
  frequency: RecurrenceFrequency;
  startDate: string;
  endDate?: string | null;
  isActive?: boolean;
}

export function validateRecurringInput(input: RecurringInput, state: FinancialCoreState): string[] {
  const errors: string[] = [];

  if (parseAmount(input.amount) === null) errors.push('Amount must be a positive number.');
  if (input.type !== 'income' && input.type !== 'expense' && input.type !== 'transfer') {
    errors.push('Choose a transaction type.');
  }
  if (!parseFrequency(input.frequency)) errors.push('Choose a frequency (weekly, monthly, or yearly).');

  const account = state.accounts.find((item) => item.id === input.accountId);
  if (!account) {
    errors.push('Choose a valid account.');
  } else if (account.isArchived) {
    errors.push('This account is archived. Unarchive it before adding a recurring transaction.');
  } else if (account.currencyCode !== input.currencyCode) {
    errors.push(`Amount currency must match the account currency (${account.currencyCode}).`);
  }

  if (input.type === 'transfer') {
    if (!input.toAccountId) errors.push('Choose a destination account for the transfer.');
    else if (input.toAccountId === input.accountId) errors.push('The destination account must be different from the source account.');
    else {
      const destination = state.accounts.find((item) => item.id === input.toAccountId);
      if (!destination) errors.push('Choose a valid destination account.');
      else if (destination.isArchived) errors.push('The destination account is archived.');
      else if (destination.currencyCode !== input.currencyCode) {
        errors.push(`Destination account currency (${destination.currencyCode}) must match the transfer currency.`);
      }
    }
  }

  if (!parseDate(input.startDate)) {
    errors.push('Choose a valid start date (YYYY-MM-DD).');
  } else if (input.endDate && isValidISODate(input.endDate) && input.endDate < input.startDate) {
    errors.push('End date must be on or after the start date.');
  }

  return errors;
}

/* ----------------------------- deterministic recurrence math ----------------------------- */

export function advanceOccurrence(frequency: RecurrenceFrequency, iso: string): string {
  if (frequency === 'weekly') return addDays(iso, 7);
  if (frequency === 'monthly') return addMonthsClamped(iso, 1);
  return addYears(iso, 1);
}

export interface RecurrenceSchedule {
  frequency: RecurrenceFrequency;
  startDate: string;
  /** Inclusive; when null the schedule runs indefinitely. */
  endDate?: string | null;
}

/**
 * Return up to `count` occurrence dates on or after `fromDate`.
 *
 * This is a pure projection — it never creates or mutates transactions, so
 * re-rendering can never produce duplicates.
 */
export function computeUpcomingOccurrences(
  schedule: RecurrenceSchedule,
  fromDate: string,
  count: number,
): string[] {
  if (count <= 0 || !isValidISODate(schedule.startDate) || !isValidISODate(fromDate)) return [];

  // Walk forward to the first occurrence on/after fromDate (bounded loop
  // defends against pathological inputs).
  let cursor = schedule.startDate;
  let guard = 0;
  while (cursor < fromDate && guard < 10_000) {
    cursor = advanceOccurrence(schedule.frequency, cursor);
    guard += 1;
  }

  const results: string[] = [];
  let current = cursor;
  let i = 0;
  while (i < count && guard < 20_000) {
    if (schedule.endDate && current > schedule.endDate) break;
    results.push(current);
    current = advanceOccurrence(schedule.frequency, current);
    i += 1;
    guard += 1;
  }
  return results;
}

/** The next occurrence strictly after `afterDate`, or null when the schedule ends. */
export function nextOccurrenceAfter(schedule: RecurrenceSchedule, afterDate: string): string | null {
  const upcoming = computeUpcomingOccurrences(schedule, afterDate, 2);
  return upcoming.find((date) => date > afterDate) ?? null;
}

/** First occurrence on/after today — the value stored as `nextOccurrenceAt`. */
export function initialNextOccurrence(schedule: RecurrenceSchedule, today?: string): string {
  const from = today ?? todayISODate();
  const upcoming = computeUpcomingOccurrences(schedule, from, 1);
  return upcoming[0] ?? schedule.startDate;
}
/* ----------------------------- CRUD ----------------------------- */

function buildRecurring(input: RecurringInput, now: string, id: string, createdAt: string): RecurringTransaction {
  const schedule: RecurrenceSchedule = {
    frequency: input.frequency,
    startDate: input.startDate,
    endDate: input.endDate,
  };
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
    frequency: input.frequency,
    startDate: input.startDate,
    endDate: parseOptionalDate(input.endDate),
    nextOccurrenceAt: initialNextOccurrence(schedule),
    isActive: input.isActive !== false,
    createdAt,
    updatedAt: now,
  };
}

export function createRecurring(
  state: FinancialCoreState,
  input: RecurringInput,
  now: string = new Date().toISOString(),
): FinancialResult<{ state: FinancialCoreState; recurring: RecurringTransaction }> {
  const validationErrors = validateRecurringInput(input, state);
  if (validationErrors.length > 0) {
    return serviceFail({ code: 'INVALID_RECURRING', message: validationErrors.join(' ') });
  }

  const recurring = buildRecurring(input, now, createId('rec'), now);
  const recurringTransactions = [...state.recurringTransactions, recurring];
  return serviceOk({ state: financialCoreStateWith(state, { recurringTransactions }), recurring });
}

export function updateRecurring(
  state: FinancialCoreState,
  id: string,
  input: RecurringInput,
  now: string = new Date().toISOString(),
): FinancialResult<{ state: FinancialCoreState; recurring: RecurringTransaction }> {
  const existing = state.recurringTransactions.find((item) => item.id === id);
  if (!existing) {
    return serviceFail({ code: 'NOT_FOUND', message: 'Recurring transaction not found.', field: 'id' });
  }

  const validationErrors = validateRecurringInput(input, state);
  if (validationErrors.length > 0) {
    return serviceFail({ code: 'INVALID_RECURRING', message: validationErrors.join(' ') });
  }

  const recurring = { ...buildRecurring(input, now, id, existing.createdAt), isActive: input.isActive !== false };
  const recurringTransactions = state.recurringTransactions.map((item) => (item.id === id ? recurring : item));
  return serviceOk({ state: financialCoreStateWith(state, { recurringTransactions }), recurring });
}

export function deleteRecurring(
  state: FinancialCoreState,
  id: string,
): FinancialResult<{ state: FinancialCoreState }> {
  const existing = state.recurringTransactions.some((item) => item.id === id);
  if (!existing) {
    return serviceFail({ code: 'NOT_FOUND', message: 'Recurring transaction not found.', field: 'id' });
  }
  const recurringTransactions = state.recurringTransactions.filter((item) => item.id !== id);
  return serviceOk({ state: financialCoreStateWith(state, { recurringTransactions }) });
}

export function toggleRecurringActive(
  state: FinancialCoreState,
  id: string,
  isActive: boolean,
  now: string = new Date().toISOString(),
): FinancialResult<{ state: FinancialCoreState; recurring: RecurringTransaction }> {
  const existing = state.recurringTransactions.find((item) => item.id === id);
  if (!existing) {
    return serviceFail({ code: 'NOT_FOUND', message: 'Recurring transaction not found.', field: 'id' });
  }
  const recurring = { ...existing, isActive, updatedAt: now };
  const recurringTransactions = state.recurringTransactions.map((item) => (item.id === id ? recurring : item));
  return serviceOk({ state: financialCoreStateWith(state, { recurringTransactions }), recurring });
}