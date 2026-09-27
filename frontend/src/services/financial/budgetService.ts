import { isSupportedCurrency } from '../../config/currencies';
import { fromMinorUnits, roundMoney, toMinorUnits } from '../../lib/money';
import type { Budget, CurrencyCode, Transaction } from '../../types/financial';
import { financialCoreStateWith, type FinancialCoreState } from './stateHelpers';
import { serviceFail, serviceOk, type FinancialResult } from './result';
import { createId } from './state';
import {
  parseAmount,
  parseBudgetPeriod,
  parseDate,
  parseOptionalText,
  parseText,
} from './validation';

/** Input contract for creating or editing a budget. */
export interface BudgetInput {
  categoryId: string;
  currencyCode: CurrencyCode;
  /** Planned spending limit for the period (must be > 0). */
  limit: number;
  period: Budget['period'];
  /** Inclusive period start (YYYY-MM-DD). */
  startDate: string;
  /** Inclusive period end (YYYY-MM-DD). */
  endDate: string;
}

export const BUDGET_PERIODS: readonly { value: Budget['period']; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

export function budgetPeriodLabel(period: Budget['period']): string {
  return BUDGET_PERIODS.find((entry) => entry.value === period)?.label ?? period;
}

/**
 * Deterministic budget spent derivation.
 *
 * `spent` is never user-entered or fabricated: it is always the exact sum
 * (integer minor-unit math) of real expense transactions in the budget's
 * category that occurred inside the budget's inclusive period.
 */
export function budgetSpentFor(budget: Budget, transactions: Transaction[]): number {
  return fromMinorUnits(
    transactions.reduce((sum, transaction) => {
      if (transaction.type !== 'expense') return sum;
      if (transaction.categoryId !== budget.categoryId) return sum;
      if (transaction.date < budget.startDate || transaction.date > budget.endDate) return sum;
      return sum + toMinorUnits(transaction.amount);
    }, 0),
  );
}

/** Recompute `spent` on every budget from the current real transactions. */
export function withDerivedBudgetSpending(budgets: Budget[], transactions: Transaction[]): Budget[] {
  return budgets.map((budget) => ({ ...budget, spent: budgetSpentFor(budget, transactions) }));
}

export function validateBudgetInput(input: BudgetInput, state: FinancialCoreState, exceptId?: string): string[] {
  const errors: string[] = [];

  const category = state.categories.find((item) => item.id === parseOptionalText(input.categoryId));
  if (!category) {
    errors.push('Choose a valid category.');
  } else if (category.type !== 'expense') {
    errors.push(`Category "${category.name}" is an income category — budgets apply to expense categories.`);
  }

  if (parseAmount(input.limit) === null) errors.push('Budget limit must be a positive number.');
  if (!parseBudgetPeriod(input.period)) errors.push('Choose a budget period (weekly, monthly, or yearly).');
  if (!isSupportedCurrency(input.currencyCode)) errors.push('Select a valid currency.');

  if (!parseDate(input.startDate)) {
    errors.push('Choose a valid period start date (YYYY-MM-DD).');
  }
  if (!parseDate(input.endDate)) {
    errors.push('Choose a valid period end date (YYYY-MM-DD).');
  }
  if (parseDate(input.startDate) && parseDate(input.endDate) && input.endDate < input.startDate) {
    errors.push('Period end date must be on or after the start date.');
  }

  // One plan per category + period + start: keeps Safe-to-Spend budget
  // commitments free of double-counted allocations.
  const duplicate = state.budgets.some(
    (budget) =>
      budget.id !== exceptId &&
      budget.categoryId === input.categoryId &&
      budget.period === input.period &&
      budget.startDate === input.startDate,
  );
  if (duplicate) errors.push('A budget for this category, period, and start date already exists.');

  return errors;
}

export function createBudget(
  state: FinancialCoreState,
  input: BudgetInput,
  now: string = new Date().toISOString(),
): FinancialResult<{ state: FinancialCoreState; budget: Budget }> {
  const validationErrors = validateBudgetInput(input, state);
  if (validationErrors.length > 0) {
    return serviceFail({ code: 'INVALID_BUDGET', message: validationErrors.join(' ') });
  }

  const budget: Budget = {
    id: createId('bud'),
    categoryId: parseText(input.categoryId)!,
    currencyCode: input.currencyCode,
    limit: roundMoney(input.limit),
    // Spent is derived from real transactions, never entered or invented.
    spent: 0,
    period: input.period,
    startDate: input.startDate,
    endDate: input.endDate,
    createdAt: now,
  };
  const budgets = [...state.budgets, { ...budget, spent: budgetSpentFor(budget, state.transactions) }];

  return serviceOk({
    state: financialCoreStateWith(state, { budgets }),
    budget: budgets[budgets.length - 1]!,
  });
}

export function updateBudget(
  state: FinancialCoreState,
  id: string,
  input: BudgetInput,
): FinancialResult<{ state: FinancialCoreState; budget: Budget }> {
  const existing = state.budgets.find((budget) => budget.id === id);
  if (!existing) {
    return serviceFail({ code: 'NOT_FOUND', message: 'Budget not found.', field: 'id' });
  }

  const validationErrors = validateBudgetInput(input, state, id);
  if (validationErrors.length > 0) {
    return serviceFail({ code: 'INVALID_BUDGET', message: validationErrors.join(' ') });
  }

  const updated: Budget = {
    ...existing,
    categoryId: parseText(input.categoryId)!,
    currencyCode: input.currencyCode,
    limit: roundMoney(input.limit),
    period: input.period,
    startDate: input.startDate,
    endDate: input.endDate,
  };
  const budgets = withDerivedBudgetSpending(
    state.budgets.map((budget) => (budget.id === id ? updated : budget)),
    state.transactions,
  );

  return serviceOk({
    state: financialCoreStateWith(state, { budgets }),
    budget: budgets.find((budget) => budget.id === id)!,
  });
}

export function deleteBudget(
  state: FinancialCoreState,
  id: string,
): FinancialResult<{ state: FinancialCoreState }> {
  const existing = state.budgets.some((budget) => budget.id === id);
  if (!existing) {
    return serviceFail({ code: 'NOT_FOUND', message: 'Budget not found.', field: 'id' });
  }
  const budgets = state.budgets.filter((budget) => budget.id !== id);
  return serviceOk({ state: financialCoreStateWith(state, { budgets }) });
}
