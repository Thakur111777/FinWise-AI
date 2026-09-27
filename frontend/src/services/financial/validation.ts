import { isSupportedCurrency } from '../../config/currencies';
import { isValidISODate } from '../../lib/date';
import { roundMoney } from '../../lib/money';
import type {
  Account,
  AccountType,
  Budget,
  Category,
  CategoryType,
  CurrencyCode,
  Goal,
  RecurrenceFrequency,
  RecurringTransaction,
  Transaction,
  TransactionType,
  UserProfile,
} from '../../types/financial';

/**
 * Validation + defensive parsing for the Financial Core.
 *
 * Everything read from persistence passes through the `parseStored*`
 * functions so malformed or corrupted data degrades to a safe empty value
 * instead of crashing the app. Everything written passes user input through
 * `validate*` function contracts.
 */

export interface FinancialError {
  field: string;
  message: string;
}

export type ValidationResult = { ok: true; errors: [] } | { ok: false; errors: FinancialError[] };

export function validateOk(): ValidationResult {
  return { ok: true, errors: [] };
}

export function validateErrors(errors: FinancialError[]): ValidationResult {
  return errors.length === 0 ? validateOk() : { ok: false, errors };
}

export function validationError(field: string, message: string): ValidationResult {
  return { ok: false, errors: [{ field, message }] };
}

/* ----------------------------- primitive parsers ----------------------------- */

/** Positive, finite, numeric monetary value rounded to the minor-unit precision. */
export function parseAmount(value: unknown): number | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    value = Number(trimmed);
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value <= 0) return null;
  return roundMoney(value);
}

export function parseOptionalAmount(value: unknown): number | null {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) return null;
  return parseAmount(value);
}

export function parseNonNegativeAmount(value: unknown): number | null {
  if (typeof value === 'string') value = Number(value.trim());
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < 0) return null;
  return roundMoney(value);
}

export function parseText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function parseOptionalText(value: unknown): string | undefined {
  return parseText(value) ?? undefined;
}

export function parseBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1) return true;
  if (value === 'false' || value === 0) return false;
  return null;
}

export function parseCurrencyCode(value: unknown): CurrencyCode | null {
  return typeof value === 'string' && isSupportedCurrency(value) ? value : null;
}

export function parseTransactionType(value: unknown): TransactionType | null {
  return value === 'income' || value === 'expense' || value === 'transfer' ? value : null;
}

export function parseCategoryType(value: unknown): CategoryType | null {
  return value === 'income' || value === 'expense' ? value : null;
}

export function parseAccountType(value: unknown): AccountType | null {
  const types: readonly AccountType[] = ['cash', 'checking', 'savings', 'creditCard', 'investment', 'other'];
  return types.includes(value as AccountType) ? (value as AccountType) : null;
}

export function parseFrequency(value: unknown): RecurrenceFrequency | null {
  return value === 'weekly' || value === 'monthly' || value === 'yearly' ? value : null;
}

export function parseBudgetPeriod(value: unknown): Budget['period'] | null {
  return value === 'weekly' || value === 'monthly' || value === 'yearly' ? value : null;
}

export function parseGoalStatus(value: unknown): Goal['status'] | null {
  return value === 'active' || value === 'paused' || value === 'completed' || value === 'archived' ? value : null;
}

export function parseDate(value: unknown): string | null {
  return isValidISODate(value) ? value : null;
}

export function parseOptionalDate(value: unknown): string | undefined {
  return isValidISODate(value) ? value : undefined;
}

/* ----------------------------- persisted entity parsers ----------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Values missing a required string field are dropped. */
function takeText(record: Record<string, unknown>, key: string): string | null {
  return isRecord(record[key]) ? null : parseText(record[key]);
}

export function parseStoredProfile(raw: unknown): UserProfile | null {
  if (!isRecord(raw)) return null;
  const id = takeText(raw, 'id');
  const name = takeText(raw, 'name');
  const currency = parseCurrencyCode(raw['primaryCurrency'] ?? raw['primaryCurrencyCode']);
  const email = parseOptionalText(raw['email']) ?? '';
  const locale = parseOptionalText(raw['locale']) ?? 'en-IN';
  const timezone = parseOptionalText(raw['timezone']) ?? 'UTC';
  const createdAt = parseOptionalText(raw['createdAt']) ?? new Date(0).toISOString();
  const updatedAt = parseOptionalText(raw['updatedAt']) ?? createdAt;
  if (!id || !name || !currency) return null;
  const payFrequency = raw['payFrequency'] === 'weekly' || raw['payFrequency'] === 'biweekly' || raw['payFrequency'] === 'monthly' || raw['payFrequency'] === 'yearly' || raw['payFrequency'] === 'irregular' || raw['payFrequency'] === 'other'
    ? raw['payFrequency']
    : undefined;
  return {
    id,
    name,
    email,
    primaryCurrency: currency,
    locale,
    timezone,
    createdAt,
    updatedAt,
    role: raw['role'] === 'admin' ? 'admin' : 'user',
    payFrequency,
    monthlyIncomeExpectation: parseOptionalAmount(raw['monthlyIncomeExpectation']),
    financialPreferences: isRecord(raw['financialPreferences'])
      ? {
          usePrimaryCurrency: parseBoolean(raw['financialPreferences']['usePrimaryCurrency']) ?? undefined,
          riskTolerance:
            raw['financialPreferences']['riskTolerance'] === 'conservative' ||
            raw['financialPreferences']['riskTolerance'] === 'balanced' ||
            raw['financialPreferences']['riskTolerance'] === 'aggressive'
              ? raw['financialPreferences']['riskTolerance']
              : undefined,
          monthStartsOn: undefined,
        }
      : undefined,
  };
}
export function parseStoredAccount(raw: unknown): Account | null {
  if (!isRecord(raw)) return null;
  const id = takeText(raw, 'id');
  const name = takeText(raw, 'name');
  const type = parseAccountType(raw['type']);
  const currencyCode = parseCurrencyCode(raw['currencyCode']);
  const initialBalance = parseNonNegativeAmount(raw['initialBalance'] ?? raw['balance']);
  if (!id || !name || !type || !currencyCode || initialBalance === null) return null;
  const currentBalance = parseNonNegativeAmount(raw['currentBalance']) ?? initialBalance;
  const createdAt = parseOptionalText(raw['createdAt']) ?? new Date().toISOString();
  return {
    id,
    name,
    type,
    currencyCode,
    initialBalance,
    currentBalance,
    institutionName: parseOptionalText(raw['institutionName']),
    isArchived: parseBoolean(raw['isArchived']) ?? false,
    createdAt,
    updatedAt: parseOptionalText(raw['updatedAt']) ?? createdAt,
  };
}

export function parseStoredCategory(raw: unknown): Category | null {
  if (!isRecord(raw)) return null;
  const id = takeText(raw, 'id');
  const name = takeText(raw, 'name');
  const type = parseCategoryType(raw['type']);
  if (!id || !name || !type) return null;
  return {
    id,
    name,
    type,
    isDefault: parseBoolean(raw['isDefault']) ?? false,
    isHidden: parseBoolean(raw['isHidden']) ?? false,
    createdAt: parseOptionalText(raw['createdAt']) ?? new Date().toISOString(),
  };
}

export function parseStoredTransaction(raw: unknown): Transaction | null {
  if (!isRecord(raw)) return null;
  const id = takeText(raw, 'id');
  const accountId = takeText(raw, 'accountId');
  const type = parseTransactionType(raw['type']);
  const amount = parseAmount(raw['amount']);
  const currencyCode = parseCurrencyCode(raw['currencyCode']);
  const date = parseDate(raw['date'] ?? raw['occurredAt']);
  if (!id || !accountId || !type || amount === null || !currencyCode || !date) return null;
  const createdAt = parseOptionalText(raw['createdAt']) ?? new Date().toISOString();
  return {
    id,
    accountId,
    toAccountId: parseOptionalText(raw['toAccountId']),
    type,
    amount,
    currencyCode,
    categoryId: parseOptionalText(raw['categoryId']),
    merchant: parseOptionalText(raw['merchant']),
    description: parseOptionalText(raw['description']),
    date,
    notes: parseOptionalText(raw['notes']),
    isRecurring: parseBoolean(raw['isRecurring']) ?? false,
    recurringTransactionId: parseOptionalText(raw['recurringTransactionId']),
    createdAt,
    updatedAt: parseOptionalText(raw['updatedAt']) ?? createdAt,
  };
}

export function parseStoredRecurring(raw: unknown): RecurringTransaction | null {
  if (!isRecord(raw)) return null;
  const id = takeText(raw, 'id');
  const accountId = takeText(raw, 'accountId');
  const type = parseTransactionType(raw['type']);
  const amount = parseAmount(raw['amount']);
  const currencyCode = parseCurrencyCode(raw['currencyCode']);
  const frequency = parseFrequency(raw['frequency'] ?? raw['schedule']);
  const startDate = parseDate(raw['startDate']);
  if (!id || !accountId || !type || amount === null || !currencyCode || !frequency || !startDate) return null;
  const createdAt = parseOptionalText(raw['createdAt']) ?? new Date().toISOString();
  const nextOccurrenceAt = parseDate(raw['nextOccurrenceAt']) ?? startDate;
  return {
    id,
    accountId,
    toAccountId: parseOptionalText(raw['toAccountId']),
    type,
    amount,
    currencyCode,
    categoryId: parseOptionalText(raw['categoryId']),
    merchant: parseOptionalText(raw['merchant']),
    description: parseOptionalText(raw['description']),
    frequency,
    startDate,
    endDate: parseOptionalDate(raw['endDate']),
    nextOccurrenceAt,
    isActive: parseBoolean(raw['isActive']) ?? false,
    createdAt,
    updatedAt: parseOptionalText(raw['updatedAt']) ?? createdAt,
  };
}

export function parseStoredBudget(raw: unknown): Budget | null {
  if (!isRecord(raw)) return null;
  const id = takeText(raw, 'id');
  const categoryId = takeText(raw, 'categoryId');
  const currencyCode = parseCurrencyCode(raw['currencyCode']);
  const limit = parseAmount(raw['limit']);
  const period = parseBudgetPeriod(raw['period']);
  const startDate = parseDate(raw['startDate']);
  const endDate = parseDate(raw['endDate'] ?? raw['periodEnd']);
  if (!id || !categoryId || !currencyCode || limit === null || !period || !startDate || !endDate) return null;
  return {
    id,
    categoryId,
    currencyCode,
    limit,
    spent: parseNonNegativeAmount(raw['spent']) ?? 0,
    period,
    startDate,
    endDate,
    createdAt: parseOptionalText(raw['createdAt']) ?? new Date().toISOString(),
  };
}

export function parseStoredGoal(raw: unknown): Goal | null {
  if (!isRecord(raw)) return null;
  const id = takeText(raw, 'id');
  const title = takeText(raw, 'title');
  const targetAmount = parseAmount(raw['targetAmount']);
  const currencyCode = parseCurrencyCode(raw['currencyCode']);
  if (!id || !title || targetAmount === null || !currencyCode) return null;
  return {
    id,
    title,
    targetAmount,
    currentAmount: parseNonNegativeAmount(raw['currentAmount'] ?? raw['savedAmount']) ?? 0,
    currencyCode,
    targetDate: parseOptionalDate(raw['targetDate']),
    categoryId: parseOptionalText(raw['categoryId']),
    status: parseGoalStatus(raw['status']) ?? 'active',
    createdAt: parseOptionalText(raw['createdAt']) ?? new Date().toISOString(),
  };
}

/** Parse an array of persisted entities, dropping invalid members safely. */
export function parseStoredArray<T>(raw: unknown, parser: (item: unknown) => T | null): T[] {
  if (!Array.isArray(raw)) return [];
  const result: T[] = [];
  for (const item of raw) {
    const parsed = parser(item);
    if (parsed !== null) result.push(parsed);
  }
  return result;
}