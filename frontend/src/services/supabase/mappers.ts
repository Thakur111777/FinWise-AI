/**
 * Database <-> application mapping boundary (Phase 3A).
 *
 * The database speaks snake_case (`primary_currency`, `currency_code`,
 * `created_at`); the application keeps its existing camelCase domain model
 * (`primaryCurrency`, `currencyCode`, `createdAt`) from src/types/financial.ts.
 * Nothing in this file changes those types — it only translates between them.
 *
 * Two important rules:
 *
 * 1. `UserProfile.email` is NOT stored in `profiles` (Supabase Auth owns the
 *    authoritative authentication email), so it must be supplied from
 *    `auth.users` when mapping a profile into the application model.
 *
 * 2. Category identity is the database uuid, exactly like accounts, goals, and
 *    every other entity. `Category.id` stays an opaque string in the
 *    application model, so this is a storage detail the rest of the app never
 *    observes. The default category *set* is still owned by the central
 *    configuration (src/config/categories.ts) and is seeded per user by
 *    `public.seed_default_categories()` in the Phase 3A migration, which mirrors
 *    those names and types exactly.
 *
 * All money values pass through roundMoney() so a value written to PostgreSQL
 * is already at minor-unit precision — the database can never receive a
 * drifted float.
 */

import { roundMoney } from '../../lib/money';
import type {
  Account,
  Budget,
  Category,
  FinancialInsight,
  FinancialPreferences,
  FinancialSnapshot,
  Goal,
  RecurringTransaction,
  Transaction,
  UserProfile,
} from '../../types/financial';
import type { NewFinancialInsight, NewFinancialSnapshot } from '../financial/intelligenceRepository';
import type {
  AccountInsert,
  AccountRow,
  BudgetInsert,
  BudgetRow,
  CategoryInsert,
  CategoryRow,
  FinancialInsightInsert,
  FinancialInsightRow,
  FinancialSnapshotInsert,
  FinancialSnapshotRow,
  GoalInsert,
  GoalRow,
  Json,
  ProfileRow,
  ProfileUpsert,
  RecurringTransactionInsert,
  RecurringTransactionRow,
  TransactionInsert,
  TransactionRow,
} from './database.types';

/* --------------------------------------------------------------------------- */
/* identity + value helpers                                                     */
/* --------------------------------------------------------------------------- */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True when a value is a canonical UUID.
 *
 * Local Phase 2 ids are prefixed (`acct-<uuid>`, `txn-<uuid>`), so they must
 * never be sent to PostgreSQL as a uuid primary key.
 */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** Pass a uuid through, and let the database generate one otherwise. */
function uuidOrUndefined(value: string | undefined): string | undefined {
  return value !== undefined && isUuid(value) ? value : undefined;
}

/**
 * Build the `id` field of an insert payload, or omit the key entirely.
 *
 * The application mints prefixed ids in Phase 2 (`acct-<uuid>`, `txn-<uuid>`,
 * `cat-…`), which are not valid uuid primary keys, so none is sent and
 * PostgreSQL applies the Phase 3A column default `gen_random_uuid()`.
 *
 * Omitting the key — rather than sending `undefined` — is what makes that
 * default reachable. postgrest-js builds a bulk upsert's `?columns=` list from
 * the union of the rows' own keys, and a listed column that is absent from a
 * row's JSON body is written as NULL unless the request asks for defaults
 * (`defaultToNull: false` in supabaseRepository.ts).
 */
function uuidColumn(value: string | undefined): { id?: string } {
  const id = uuidOrUndefined(value);
  return id === undefined ? {} : { id };
}

/** Empty/whitespace-only text becomes null, matching the Financial Core. */
function textOrNull(value: string | undefined | null): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Map a nullable text column to `undefined` (not `null`) in the app model. */
function optionalText(value: string | null): string | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/** Convert a typed object into a JSON object safe for a `jsonb` column. */
function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? null)) as Json;
}

/** Narrow a `jsonb` value back to FinancialPreferences when it is an object. */
function toFinancialPreferences(value: Json | null): FinancialPreferences | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as FinancialPreferences;
}

/* --------------------------------------------------------------------------- */
/* profiles                                                                     */
/* --------------------------------------------------------------------------- */

/**
 * Map a `profiles` row into the application `UserProfile`.
 *
 * @param row   the database row
 * @param email authoritative authentication email from Supabase Auth
 *              (`auth.users.email`) — never read from `profiles`
 */
export function toAppProfile(row: ProfileRow, email: string): UserProfile {
  return {
    id: row.id,
    name: row.name,
    email,
    primaryCurrency: row.primary_currency,
    locale: row.locale,
    timezone: row.timezone,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    role: row.role,
    payFrequency: row.pay_frequency ?? undefined,
    monthlyIncomeExpectation: row.monthly_income_expectation,
    financialPreferences: toFinancialPreferences(row.financial_preferences),
  };
}

/** Map the application `UserProfile` into a `profiles` upsert payload. */
export function toProfileUpsert(profile: UserProfile): ProfileUpsert {
  return {
    id: profile.id,
    name: profile.name,
    primary_currency: profile.primaryCurrency,
    locale: profile.locale,
    timezone: profile.timezone,
    role: profile.role,
    pay_frequency: profile.payFrequency ?? null,
    monthly_income_expectation: profile.monthlyIncomeExpectation ?? null,
    financial_preferences:
      profile.financialPreferences === undefined ? null : toJson(profile.financialPreferences),
    created_at: profile.createdAt,
    updated_at: profile.updatedAt,
  };
}

/* --------------------------------------------------------------------------- */
/* accounts                                                                     */
/* --------------------------------------------------------------------------- */

export function toAppAccount(row: AccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    currencyCode: row.currency_code,
    initialBalance: row.initial_balance,
    currentBalance: row.current_balance,
    institutionName: optionalText(row.institution_name),
    isArchived: row.is_archived,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Map an application `Account` into an `accounts` insert payload.
 *
 * `currentBalance` is written as the already-derived value so a fresh row is
 * immediately correct, but it is still re-derived on load
 * (see supabaseRepository.ts) so an effect can never be applied twice.
 */
export function toAccountInsert(account: Account, userId: string): AccountInsert {
  return {
    ...uuidColumn(account.id),
    user_id: userId,
    name: account.name,
    type: account.type,
    currency_code: account.currencyCode,
    initial_balance: roundMoney(account.initialBalance),
    current_balance: roundMoney(account.currentBalance),
    institution_name: textOrNull(account.institutionName),
    is_archived: account.isArchived,
    created_at: account.createdAt,
    updated_at: account.updatedAt,
  };
}

/* --------------------------------------------------------------------------- */
/* categories                                                                   */
/* --------------------------------------------------------------------------- */

/**
 * Map a `categories` row into the application `Category`.
 *
 * The id is the database uuid, uniform with every other entity, so renaming a
 * category keeps existing transactions, budgets, and goals pointing at it.
 */
export function toAppCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    isDefault: row.is_default,
    isHidden: row.is_hidden,
    createdAt: row.created_at,
  };
}

/**
 * Map an application `Category` into a `categories` insert payload.
 *
 * A Phase 2 local category id is a slug, not a uuid, so none is sent: such a
 * row is matched by its natural key (user_id, type, name) instead of by id.
 */
export function toCategoryInsert(category: Category, userId: string): CategoryInsert {
  return {
    ...uuidColumn(category.id),
    user_id: userId,
    name: category.name,
    type: category.type,
    is_default: category.isDefault === true,
    is_hidden: category.isHidden === true,
    created_at: category.createdAt,
  };
}

/* --------------------------------------------------------------------------- */
/* transactions                                                                 */
/* --------------------------------------------------------------------------- */

export function toAppTransaction(row: TransactionRow): Transaction {
  return {
    id: row.id,
    accountId: row.account_id,
    toAccountId: row.to_account_id ?? undefined,
    type: row.type,
    amount: row.amount,
    currencyCode: row.currency_code,
    categoryId: row.category_id ?? undefined,
    merchant: optionalText(row.merchant),
    description: optionalText(row.description),
    date: row.date,
    notes: optionalText(row.notes),
    isRecurring: row.is_recurring,
    recurringTransactionId: row.recurring_transaction_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toTransactionInsert(transaction: Transaction, userId: string): TransactionInsert {
  return {
    ...uuidColumn(transaction.id),
    user_id: userId,
    account_id: transaction.accountId,
    to_account_id: transaction.type === 'transfer' ? (transaction.toAccountId ?? null) : null,
    type: transaction.type,
    amount: roundMoney(transaction.amount),
    currency_code: transaction.currencyCode,
    category_id: transaction.type === 'transfer' ? null : (transaction.categoryId ?? null),
    merchant: textOrNull(transaction.merchant),
    description: textOrNull(transaction.description),
    date: transaction.date,
    notes: textOrNull(transaction.notes),
    is_recurring: transaction.isRecurring,
    recurring_transaction_id: uuidOrUndefined(transaction.recurringTransactionId) ?? null,
    created_at: transaction.createdAt,
    updated_at: transaction.updatedAt,
  };
}

/* --------------------------------------------------------------------------- */
/* recurring transactions                                                       */
/* --------------------------------------------------------------------------- */

export function toAppRecurringTransaction(row: RecurringTransactionRow): RecurringTransaction {
  return {
    id: row.id,
    accountId: row.account_id,
    toAccountId: row.to_account_id ?? undefined,
    type: row.type,
    amount: row.amount,
    currencyCode: row.currency_code,
    categoryId: row.category_id ?? undefined,
    merchant: optionalText(row.merchant),
    description: optionalText(row.description),
    frequency: row.frequency,
    startDate: row.start_date,
    endDate: row.end_date ?? undefined,
    nextOccurrenceAt: row.next_occurrence_at,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toRecurringTransactionInsert(
  recurring: RecurringTransaction,
  userId: string,
): RecurringTransactionInsert {
  return {
    ...uuidColumn(recurring.id),
    user_id: userId,
    account_id: recurring.accountId,
    to_account_id: recurring.type === 'transfer' ? (recurring.toAccountId ?? null) : null,
    type: recurring.type,
    amount: roundMoney(recurring.amount),
    currency_code: recurring.currencyCode,
    category_id: recurring.type === 'transfer' ? null : (recurring.categoryId ?? null),
    merchant: textOrNull(recurring.merchant),
    description: textOrNull(recurring.description),
    frequency: recurring.frequency,
    start_date: recurring.startDate,
    end_date: recurring.endDate ?? null,
    next_occurrence_at: recurring.nextOccurrenceAt,
    is_active: recurring.isActive,
    created_at: recurring.createdAt,
    updated_at: recurring.updatedAt,
  };
}

/* --------------------------------------------------------------------------- */
/* budgets                                                                      */
/* --------------------------------------------------------------------------- */

export function toAppBudget(row: BudgetRow): Budget {
  return {
    id: row.id,
    categoryId: row.category_id,
    currencyCode: row.currency_code,
    limit: row.limit_amount,
    spent: row.spent,
    period: row.period,
    startDate: row.start_date,
    endDate: row.end_date,
    createdAt: row.created_at,
  };
}

export function toBudgetInsert(budget: Budget, userId: string): BudgetInsert {
  return {
    ...uuidColumn(budget.id),
    user_id: userId,
    category_id: budget.categoryId,
    currency_code: budget.currencyCode,
    limit_amount: roundMoney(budget.limit),
    // Always written from the derived value so stored spending can never drift
    // or double-count (see withDerivedBudgetSpending in budgetService.ts).
    spent: roundMoney(budget.spent),
    period: budget.period,
    start_date: budget.startDate,
    end_date: budget.endDate,
    created_at: budget.createdAt,
  };
}

/* --------------------------------------------------------------------------- */
/* goals                                                                        */
/* --------------------------------------------------------------------------- */

export function toAppGoal(row: GoalRow): Goal {
  return {
    id: row.id,
    title: row.title,
    targetAmount: row.target_amount,
    currentAmount: row.current_amount,
    currencyCode: row.currency_code,
    targetDate: row.target_date ?? undefined,
    categoryId: row.category_id ?? undefined,
    status: row.status,
    createdAt: row.created_at,
  };
}

export function toGoalInsert(goal: Goal, userId: string): GoalInsert {
  return {
    ...uuidColumn(goal.id),
    user_id: userId,
    title: goal.title,
    target_amount: roundMoney(goal.targetAmount),
    current_amount: roundMoney(goal.currentAmount),
    currency_code: goal.currencyCode,
    target_date: goal.targetDate ?? null,
    category_id: goal.categoryId ?? null,
    status: goal.status,
    created_at: goal.createdAt,
  };
}

/* --------------------------------------------------------------------------- */
/* financial_snapshots (Phase 4B)                                               */
/* --------------------------------------------------------------------------- */

export function toAppFinancialSnapshot(row: FinancialSnapshotRow): FinancialSnapshot {
  return {
    id: row.id,
    userId: row.user_id,
    capturedAt: row.captured_at,
    netWorth: row.net_worth,
    cashFlow: row.cash_flow,
    safeToSpend: row.safe_to_spend,
    financialHealthScore: row.financial_health_score,
    income: row.income,
    expenses: row.expenses,
    savingsRate: row.savings_rate,
    debt: row.debt,
    currencyCode: row.currency_code,
  };
}

/**
 * Build the append-only snapshot insert payload.
 *
 * Money values pass through roundMoney() at the mapper boundary (the same rule
 * as every other collection) and `id`/`captured_at` are omitted so the Phase 3A
 * column defaults (`gen_random_uuid()`, `now()`) stay reachable.
 */
export function toFinancialSnapshotInsert(
  snapshot: NewFinancialSnapshot,
  userId: string,
): FinancialSnapshotInsert {
  return {
    user_id: userId,
    net_worth: roundMoney(snapshot.netWorth),
    cash_flow: roundMoney(snapshot.cashFlow),
    safe_to_spend: roundMoney(snapshot.safeToSpend),
    financial_health_score: Math.round(snapshot.financialHealthScore),
    income: roundMoney(snapshot.income),
    expenses: roundMoney(snapshot.expenses),
    savings_rate: Math.round(snapshot.savingsRate),
    debt: roundMoney(snapshot.debt),
    currency_code: snapshot.currencyCode,
  };
}

/* --------------------------------------------------------------------------- */
/* financial_insights (Phase 4B)                                                */
/* --------------------------------------------------------------------------- */

export function toAppFinancialInsight(row: FinancialInsightRow): FinancialInsight {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    title: row.title,
    summary: row.summary,
    details: row.details,
    confidence: row.confidence,
    createdAt: row.created_at,
    category: row.category ?? undefined,
  };
}

export function toFinancialInsightInsert(
  insight: NewFinancialInsight,
  userId: string,
): FinancialInsightInsert {
  return {
    user_id: userId,
    type: insight.type,
    title: insight.title,
    summary: insight.summary,
    details: insight.details,
    confidence: insight.confidence,
    category: textOrNull(insight.category),
  };
}

/** Map a partial application-model patch onto the snake_case update payload. */
export function toFinancialInsightUpdate(
  patch: Partial<NewFinancialInsight>,
): Partial<FinancialInsightRow> {
  const payload: Partial<FinancialInsightRow> = {};
  if (patch.type !== undefined) payload.type = patch.type;
  if (patch.title !== undefined) payload.title = patch.title;
  if (patch.summary !== undefined) payload.summary = patch.summary;
  if (patch.details !== undefined) payload.details = patch.details;
  if (patch.confidence !== undefined) payload.confidence = patch.confidence;
  if (patch.category !== undefined) payload.category = textOrNull(patch.category);
  return payload;
}