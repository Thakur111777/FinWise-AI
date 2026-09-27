import { DEFAULT_LOCALE, isSupportedCurrency } from '../../config/currencies';
import { createDefaultCategories } from '../../config/categories';
import type { CurrencyCode, FinancialPreferences, PayFrequency, UserProfile } from '../../types/financial';
import { financialCoreStateWith, type FinancialCoreState } from './stateHelpers';
import { serviceOk, type FinancialResult } from './result';
import { createId } from './state';
import { parseAmount, parseOptionalText, parseText } from './validation';

/** Input contract for creating or updating the user profile. */
export interface ProfileInput {
  name: string;
  email?: string;
  primaryCurrency: CurrencyCode;
  locale?: string;
  timezone?: string;
  payFrequency?: PayFrequency | '';
  monthlyIncomeExpectation?: number | null | '';
  financialPreferences?: FinancialPreferences;
}

const PAY_FREQUENCIES: readonly { value: PayFrequency; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Bi-weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'irregular', label: 'Irregular' },
  { value: 'other', label: 'Other' },
];

export function payFrequencyLabel(value?: string): string {
  return PAY_FREQUENCIES.find((entry) => entry.value === value)?.label ?? 'Not set';
}

export function isValidPayFrequency(value: unknown): value is PayFrequency {
  return PAY_FREQUENCIES.some((entry) => entry.value === value);
}

export function validateProfileInput(input: ProfileInput): string[] {
  const errors: string[] = [];
  if (!parseText(input.name)) errors.push('Name is required.');
  if (!isSupportedCurrency(input.primaryCurrency)) errors.push('Choose a valid primary currency.');
  if (input.payFrequency && !isValidPayFrequency(input.payFrequency)) {
    errors.push('Choose a valid pay frequency.');
  }
  if (input.monthlyIncomeExpectation !== undefined && input.monthlyIncomeExpectation !== null && input.monthlyIncomeExpectation !== '') {
    if (parseAmount(input.monthlyIncomeExpectation) === null) {
      errors.push('Monthly income expectation must be a positive number.');
    }
  }
  return errors;
}

/**
 * Create or update the profile. When a profile is created for the first
 * time (fresh state), the default category set is seeded so transactions
 * always have honest, typed categories to reference.
 */
export function saveProfile(
  state: FinancialCoreState,
  input: ProfileInput,
  now: string = new Date().toISOString(),
): FinancialResult<{ state: FinancialCoreState; profile: UserProfile; seededCategories: boolean }> {
  const errors = validateProfileInput(input);
  if (errors.length > 0) {
    return { ok: false, error: { code: 'INVALID_PROFILE', message: errors.join(' ') } };
  }

  const existing = state.profile;
  const isNewProfile = existing === null;
  const profile: UserProfile = {
    id: existing?.id ?? createId('user'),
    name: parseText(input.name)!,
    email: parseOptionalText(input.email) ?? existing?.email ?? '',
    primaryCurrency: input.primaryCurrency,
    locale: parseOptionalText(input.locale) ?? existing?.locale ?? DEFAULT_LOCALE,
    timezone: parseOptionalText(input.timezone) ?? existing?.timezone ?? 'UTC',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    role: existing?.role ?? 'user',
    payFrequency: input.payFrequency ? input.payFrequency : existing?.payFrequency,
    monthlyIncomeExpectation:
      input.monthlyIncomeExpectation === '' || input.monthlyIncomeExpectation === null
        ? null
        : input.monthlyIncomeExpectation !== undefined
          ? parseAmount(input.monthlyIncomeExpectation)
          : existing?.monthlyIncomeExpectation,
    financialPreferences: input.financialPreferences ?? existing?.financialPreferences,
  };

  let categories = state.categories;
  let seededCategories = false;
  if (isNewProfile && categories.length === 0) {
    categories = createDefaultCategories(now);
    seededCategories = true;
  }

  return serviceOk({
    state: financialCoreStateWith(state, { profile, categories }),
    profile,
    seededCategories,
  });
}