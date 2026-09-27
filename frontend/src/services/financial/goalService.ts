import { isSupportedCurrency } from '../../config/currencies';
import { roundMoney } from '../../lib/money';
import type { CurrencyCode, Goal } from '../../types/financial';
import { financialCoreStateWith, type FinancialCoreState } from './stateHelpers';
import { serviceFail, serviceOk, type FinancialResult } from './result';
import { createId } from './state';
import {
  parseAmount,
  parseDate,
  parseGoalStatus,
  parseNonNegativeAmount,
  parseOptionalDate,
  parseOptionalText,
  parseText,
} from './validation';

/** Input contract for creating or editing a goal. */
export interface GoalInput {
  title: string;
  /** Total amount the user is aiming for (must be > 0). */
  targetAmount: number;
  /** Amount already saved toward the goal (>= 0). */
  currentAmount: number;
  currencyCode: CurrencyCode;
  /** Optional target date (YYYY-MM-DD). */
  targetDate?: string | null;
  /** Optional expense-category association where it makes sense. */
  categoryId?: string | null;
  /** Defaults to 'active' on creation. */
  status?: Goal['status'];
}

export const GOAL_STATUSES: readonly { value: Goal['status']; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'completed', label: 'Completed' },
  { value: 'archived', label: 'Archived' },
];

export function goalStatusLabel(status: Goal['status']): string {
  return GOAL_STATUSES.find((entry) => entry.value === status)?.label ?? status;
}

export function validateGoalInput(input: GoalInput, state: FinancialCoreState): string[] {
  const errors: string[] = [];

  if (!parseText(input.title)) errors.push('Goal name is required.');
  if (parseAmount(input.targetAmount) === null) errors.push('Target amount must be a positive number.');
  if (parseNonNegativeAmount(input.currentAmount) === null) {
    errors.push('Saved amount must be zero or a positive number.');
  }
  if (parseAmount(input.targetAmount) !== null && parseNonNegativeAmount(input.currentAmount) !== null) {
    // Guardrail, not a fabricated value: savings cannot exceed the goal target.
    if (roundMoney(input.currentAmount) > roundMoney(input.targetAmount)) {
      errors.push('Saved amount cannot be greater than the target amount.');
    }
  }
  if (!isSupportedCurrency(input.currencyCode)) errors.push('Select a valid currency.');

  if (input.targetDate !== undefined && input.targetDate !== null && input.targetDate !== '') {
    if (!parseDate(input.targetDate)) errors.push('Choose a valid target date (YYYY-MM-DD).');
  }

  if (input.categoryId !== undefined && input.categoryId !== null && input.categoryId !== '') {
    const category = state.categories.find((item) => item.id === input.categoryId);
    if (!category) errors.push('Choose a valid category.');
  }

  if (input.status !== undefined && parseGoalStatus(input.status) === null) {
    errors.push('Choose a valid goal status.');
  }

  return errors;
}

export function createGoal(
  state: FinancialCoreState,
  input: GoalInput,
  now: string = new Date().toISOString(),
): FinancialResult<{ state: FinancialCoreState; goal: Goal }> {
  const validationErrors = validateGoalInput(input, state);
  if (validationErrors.length > 0) {
    return serviceFail({ code: 'INVALID_GOAL', message: validationErrors.join(' ') });
  }

  const goal: Goal = {
    id: createId('goal'),
    title: parseText(input.title)!,
    targetAmount: roundMoney(input.targetAmount),
    currentAmount: parseNonNegativeAmount(input.currentAmount)!,
    currencyCode: input.currencyCode,
    targetDate: parseOptionalDate(input.targetDate),
    categoryId: parseOptionalText(input.categoryId),
    status: input.status ?? 'active',
    createdAt: now,
  };

  const goals = [...state.goals, goal];
  return serviceOk({ state: financialCoreStateWith(state, { goals }), goal });
}

export function updateGoal(
  state: FinancialCoreState,
  id: string,
  input: GoalInput,
  now: string = new Date().toISOString(),
): FinancialResult<{ state: FinancialCoreState; goal: Goal }> {
  const existing = state.goals.find((goal) => goal.id === id);
  if (!existing) {
    return serviceFail({ code: 'NOT_FOUND', message: 'Goal not found.', field: 'id' });
  }

  const validationErrors = validateGoalInput(input, state);
  if (validationErrors.length > 0) {
    return serviceFail({ code: 'INVALID_GOAL', message: validationErrors.join(' ') });
  }

  void now;
  const goal: Goal = {
    ...existing,
    title: parseText(input.title)!,
    targetAmount: roundMoney(input.targetAmount),
    currentAmount: parseNonNegativeAmount(input.currentAmount)!,
    currencyCode: input.currencyCode,
    targetDate: parseOptionalDate(input.targetDate),
    categoryId: parseOptionalText(input.categoryId),
    status: input.status ?? existing.status,
  };

  const goals = state.goals.map((item) => (item.id === id ? goal : item));
  return serviceOk({ state: financialCoreStateWith(state, { goals }), goal });
}

export function deleteGoal(
  state: FinancialCoreState,
  id: string,
): FinancialResult<{ state: FinancialCoreState }> {
  const existing = state.goals.some((goal) => goal.id === id);
  if (!existing) {
    return serviceFail({ code: 'NOT_FOUND', message: 'Goal not found.', field: 'id' });
  }
  const goals = state.goals.filter((goal) => goal.id !== id);
  return serviceOk({ state: financialCoreStateWith(state, { goals }) });
}
