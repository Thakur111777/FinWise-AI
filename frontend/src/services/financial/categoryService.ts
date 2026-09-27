import { categoryIdFor } from '../../config/categories';
import type { Category, CategoryType } from '../../types/financial';
import { financialCoreStateWith, type FinancialCoreState } from './stateHelpers';
import { serviceFail, serviceOk, type FinancialResult } from './result';
import { parseBoolean, parseText } from './validation';

/** Input contract for creating or editing a category. */
export interface CategoryInput {
  name: string;
  type: CategoryType;
  isHidden?: boolean;
}

function isCategoryNameTaken(categories: Category[], name: string, type: CategoryType, exceptId?: string): boolean {
  const normalized = name.trim().toLowerCase();
  return categories.some(
    (category) =>
      category.id !== exceptId &&
      category.type === type &&
      category.name.trim().toLowerCase() === normalized,
  );
}

/**
 * A category is "in use" when any transaction references it. Used to guard
 * hidden/default state so history never points at a vanished category.
 */
export function isCategoryInUse(categories: Category[], categoriesUsed: readonly string[]): boolean {
  const idSet = new Set(categoriesUsed);
  return categories.some((category) => idSet.has(category.id));
}

export function validateCategoryInput(input: CategoryInput, categories: Category[], exceptId?: string): string[] {
  const errors: string[] = [];
  if (!parseText(input.name)) {
    errors.push('Category name is required.');
  } else if (isCategoryNameTaken(categories, input.name, input.type, exceptId)) {
    errors.push(`A ${input.type} category with this name already exists.`);
  }
  if (input.type !== 'income' && input.type !== 'expense') {
    errors.push('Category type must be income or expense.');
  }
  return errors;
}

export function createCategory(
  state: FinancialCoreState,
  input: CategoryInput,
  now: string = new Date().toISOString(),
): FinancialResult<{ state: FinancialCoreState; category: Category }> {
  const validationErrors = validateCategoryInput(input, state.categories);
  if (validationErrors.length > 0) {
    return serviceFail({ code: 'INVALID_CATEGORY', message: validationErrors.join(' ') });
  }

  const name = parseText(input.name)!;
  const category: Category = {
    id: categoryIdFor(input.type, name),
    name,
    type: input.type,
    isDefault: false,
    isHidden: parseBoolean(input.isHidden) ?? false,
    createdAt: now,
  };

  const categories = [...state.categories, category];
  return serviceOk({ state: financialCoreStateWith(state, { categories }), category });
}

export function updateCategory(
  state: FinancialCoreState,
  id: string,
  input: CategoryInput,
): FinancialResult<{ state: FinancialCoreState; category: Category }> {
  const existing = state.categories.find((category) => category.id === id);
  if (!existing) {
    return serviceFail({ code: 'NOT_FOUND', message: 'Category not found.', field: 'id' });
  }

  const validationErrors = validateCategoryInput(input, state.categories, id);
  if (validationErrors.length > 0) {
    return serviceFail({ code: 'INVALID_CATEGORY', message: validationErrors.join(' ') });
  }
  if (input.type !== existing.type) {
    return serviceFail({
      code: 'INVALID_CATEGORY',
      message: 'Changing the category type is not allowed after creation.',
      field: 'type',
    });
  }

  const category: Category = {
    ...existing,
    name: parseText(input.name)!,
    isHidden: parseBoolean(input.isHidden) ?? existing.isHidden,
  };

  const categories = state.categories.map((item) => (item.id === id ? category : item));
  return serviceOk({ state: financialCoreStateWith(state, { categories }), category });
}

/** Hide a category. Refuses when transactions still reference it. */
export function hideCategory(
  state: FinancialCoreState,
  id: string,
): FinancialResult<{ state: FinancialCoreState; category: Category }> {
  const existing = state.categories.find((category) => category.id === id);
  if (!existing) {
    return serviceFail({ code: 'NOT_FOUND', message: 'Category not found.', field: 'id' });
  }
  const inUse = state.transactions.some((transaction) => transaction.categoryId === id);
  if (inUse) {
    return serviceFail({
      code: 'CATEGORY_IN_USE',
      message: 'This category is used by existing transactions and cannot be hidden.',
    });
  }
  const category = { ...existing, isHidden: true };
  const categories = state.categories.map((item) => (item.id === id ? category : item));
  return serviceOk({ state: financialCoreStateWith(state, { categories }), category });
}

export function unhideCategory(
  state: FinancialCoreState,
  id: string,
): FinancialResult<{ state: FinancialCoreState; category: Category }> {
  const existing = state.categories.find((category) => category.id === id);
  if (!existing) {
    return serviceFail({ code: 'NOT_FOUND', message: 'Category not found.', field: 'id' });
  }
  const category = { ...existing, isHidden: false };
  const categories = state.categories.map((item) => (item.id === id ? category : item));
  return serviceOk({ state: financialCoreStateWith(state, { categories }), category });
}