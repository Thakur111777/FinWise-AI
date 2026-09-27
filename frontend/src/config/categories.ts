import type { Category, CategoryType } from '../types/financial';

/**
 * Central category configuration/default system.
 *
 * The Financial Core ships with a fixed set of typed default categories.
 * Pages never hardcode category logic — they consume `Category` values from
 * the financial state (seeded from this config when a profile is created).
 * Users can extend the set with custom categories.
 */
export const DEFAULT_EXPENSE_CATEGORY_NAMES = [
  'Housing',
  'Food',
  'Transportation',
  'Shopping',
  'Entertainment',
  'Health',
  'Education',
  'Subscriptions',
  'Travel',
  'Bills',
  'Personal',
  'Other',
] as const;

export const DEFAULT_INCOME_CATEGORY_NAMES = ['Salary', 'Freelance', 'Business', 'Investment', 'Gift', 'Other'] as const;

/** Stable slug used as the category id in storage, e.g. "expense-food". */
export function categoryIdFor(type: CategoryType, name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${type}-${slug || 'uncategorized'}`;
}

/** Build the full default category set with stable ids and timestamps. */
export function createDefaultCategories(now: string): Category[] {
  const income = DEFAULT_INCOME_CATEGORY_NAMES.map((name) => ({
    id: categoryIdFor('income', name),
    name,
    type: 'income' as const,
    isDefault: true,
    createdAt: now,
  }));
  const expense = DEFAULT_EXPENSE_CATEGORY_NAMES.map((name) => ({
    id: categoryIdFor('expense', name),
    name,
    type: 'expense' as const,
    isDefault: true,
    createdAt: now,
  }));
  return [...income, ...expense];
}