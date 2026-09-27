/**
 * Supabase/PostgreSQL row types (Phase 3A).
 *
 * Hand-maintained to match
 * supabase/migrations/20260915090000_phase3a_initial_schema.sql exactly —
 * column names stay snake_case and timestamps stay ISO-8601 strings, because
 * that is what PostgREST returns.
 *
 * These types describe database rows only. The application keeps its existing
 * camelCase domain model (src/types/financial.ts); the boundary between the two
 * is src/services/supabase/mappers.ts.
 *
 * Regenerating with `supabase gen types typescript` later is fine as long as the
 * mapper layer is updated in the same change.
 */

/** Shape PostgreSQL `jsonb` values arrive as over PostgREST. */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

/** Supported ISO-style currency codes (mirrors src/config/currencies.ts). */
export type CurrencyCodeRow = 'INR' | 'USD' | 'EUR' | 'GBP' | 'JPY' | 'CAD' | 'AUD';

export interface ProfileRow {
  id: string;
  name: string;
  primary_currency: CurrencyCodeRow;
  locale: string;
  timezone: string;
  role: 'user' | 'admin';
  pay_frequency: 'weekly' | 'biweekly' | 'monthly' | 'yearly' | 'irregular' | 'other' | null;
  monthly_income_expectation: number | null;
  financial_preferences: Json | null;
  created_at: string;
  updated_at: string;
}

export interface AccountRow {
  id: string;
  user_id: string;
  name: string;
  type: 'cash' | 'checking' | 'savings' | 'creditCard' | 'investment' | 'other';
  currency_code: CurrencyCodeRow;
  initial_balance: number;
  current_balance: number;
  institution_name: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface CategoryRow {
  id: string;
  user_id: string;
  name: string;
  type: 'income' | 'expense';
  is_default: boolean;
  is_hidden: boolean;
  created_at: string;
}

export interface TransactionRow {
  id: string;
  user_id: string;
  account_id: string;
  to_account_id: string | null;
  type: 'income' | 'expense' | 'transfer';
  amount: number;
  currency_code: CurrencyCodeRow;
  category_id: string | null;
  merchant: string | null;
  description: string | null;
  date: string;
  notes: string | null;
  is_recurring: boolean;
  recurring_transaction_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecurringTransactionRow {
  id: string;
  user_id: string;
  account_id: string;
  to_account_id: string | null;
  type: 'income' | 'expense' | 'transfer';
  amount: number;
  currency_code: CurrencyCodeRow;
  category_id: string | null;
  merchant: string | null;
  description: string | null;
  frequency: 'weekly' | 'monthly' | 'yearly';
  start_date: string;
  end_date: string | null;
  next_occurrence_at: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface BudgetRow {
  id: string;
  user_id: string;
  category_id: string;
  currency_code: CurrencyCodeRow;
  limit_amount: number;
  spent: number;
  period: 'weekly' | 'monthly' | 'yearly';
  start_date: string;
  end_date: string;
  created_at: string;
}

export interface GoalRow {
  id: string;
  user_id: string;
  title: string;
  target_amount: number;
  current_amount: number;
  currency_code: CurrencyCodeRow;
  target_date: string | null;
  category_id: string | null;
  status: 'active' | 'paused' | 'completed' | 'archived';
  created_at: string;
}

export interface FinancialSnapshotRow {
  id: string;
  user_id: string;
  captured_at: string;
  net_worth: number;
  cash_flow: number;
  safe_to_spend: number;
  financial_health_score: number;
  income: number;
  expenses: number;
  savings_rate: number;
  debt: number;
  currency_code: CurrencyCodeRow;
}

export interface FinancialInsightRow {
  id: string;
  user_id: string;
  type: 'alert' | 'optimization' | 'forecast' | 'risk' | 'milestone';
  title: string;
  summary: string;
  details: string;
  confidence: number;
  category: string | null;
  created_at: string;
}

export interface LifeEventRow {
  id: string;
  user_id: string;
  type:
    | 'buy_car'
    | 'buy_house'
    | 'marriage'
    | 'baby'
    | 'college'
    | 'vacation'
    | 'move'
    | 'new_job'
    | 'job_loss'
    | 'start_business'
    | 'custom';
  title: string;
  date: string | null;
  amount: number | null;
  currency_code: CurrencyCodeRow | null;
  notes: string | null;
}

export interface ScenarioRow {
  id: string;
  user_id: string;
  name: string;
  description: string;
  assumptions: Json;
  projected_net_worth: number;
  confidence: number;
  created_at: string;
}

export interface DecisionRow {
  id: string;
  user_id: string;
  question: string;
  answer: 'yes' | 'no' | 'maybe';
  affordability_score: number;
  explanation: string;
  created_at: string;
}

export interface FinancialMemoryRow {
  id: string;
  user_id: string;
  theme: 'spending' | 'goal' | 'risk' | 'habit' | 'milestone';
  title: string;
  description: string;
  context: Json;
  created_at: string;
}

/** Insert payload for a row owned by the current user. */
export type AccountInsert = Omit<AccountRow, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type CategoryInsert = Omit<CategoryRow, 'id' | 'created_at'> & {
  id?: string;
  created_at?: string;
};

export type TransactionInsert = Omit<TransactionRow, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type RecurringTransactionInsert = Omit<
  RecurringTransactionRow,
  'id' | 'created_at' | 'updated_at'
> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type BudgetInsert = Omit<BudgetRow, 'id' | 'created_at'> & {
  id?: string;
  created_at?: string;
};

export type GoalInsert = Omit<GoalRow, 'id' | 'created_at'> & {
  id?: string;
  created_at?: string;
};

export type ProfileUpsert = Omit<ProfileRow, 'created_at' | 'updated_at'> & {
  created_at?: string;
  updated_at?: string;
};

/**
 * Insert payloads for the Phase 4 intelligence tables (Phase 4B).
 *
 * Snapshots are append-only (the table has no UPDATE policy): a capture never
 * carries an id or a captured_at — PostgreSQL supplies the uuid default and
 * `now()`. Insights may be updated later (dismissal in Phase 4D), so inserts
 * leave `id`/`created_at` to the database as well.
 */
export type FinancialSnapshotInsert = Omit<FinancialSnapshotRow, 'id' | 'captured_at'> & {
  id?: string;
  captured_at?: string;
};

export type FinancialInsightInsert = Omit<FinancialInsightRow, 'id' | 'created_at'> & {
  id?: string;
  created_at?: string;
};