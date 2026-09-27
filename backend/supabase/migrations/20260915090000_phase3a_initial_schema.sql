-- ============================================================================
-- FinWise AI — Phase 3A: Initial Supabase / PostgreSQL schema
-- ============================================================================
--
-- Locked architecture:
--
--   React Frontend
--     -> FinWise Backend / secure server boundary
--     -> Supabase (Auth + PostgreSQL)
--     -> Row Level Security
--
-- Scope of this migration (Phase 3A ONLY):
--   * user-owned relational tables with UUID primary keys
--   * timestamptz timestamps, real foreign keys, CHECK constraints
--   * indexes for the queries the deterministic intelligence layer performs
--   * a reusable safe updated_at trigger
--   * Row Level Security on every user-owned table
--   * default seeding of profiles + the central default category set
--
-- NOT in scope: AI provider calls, forecasting, Life Event Lab,
-- Decision Intelligence, or any Phase 4/5 behaviour.
--
-- Column names are snake_case (database convention). The application keeps
-- its existing camelCase domain model (src/types/financial.ts); the mapping
-- boundary lives in src/services/supabase/mappers.ts.
--
-- Notes on domain compatibility (src/types/financial.ts, src/config/*):
--   * `profiles.email` intentionally does NOT exist — Supabase Auth owns the
--     authoritative authentication email (auth.users.email).
--   * Supported currency codes mirror src/config/currencies.ts.
--   * Category names/types mirror src/config/categories.ts.
--   * accounts.current_balance is DERIVED. See the table comment.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 0. Extensions
-- ----------------------------------------------------------------------------
-- gen_random_uuid() is available in PostgreSQL 13+ core functions; pgcrypto is
-- declared here for portability. On Supabase this is a no-op because the
-- extension is already installed in the `extensions` schema.
create extension if not exists pgcrypto with schema extensions;

-- ----------------------------------------------------------------------------
-- 1. Shared helper functions
-- ----------------------------------------------------------------------------

-- Reusable, safe updated_at trigger function.
-- SECURITY INVOKER: it runs with the caller's privileges and can therefore
-- only ever touch the row the caller's own statement is already writing.
-- Empty search_path: no object resolution can be hijacked by a caller.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Reusable BEFORE UPDATE trigger: stamps updated_at with now(). Safe for shared use by any table that owns an updated_at column.';

-- NOTE: the owns_account / owns_category ownership predicates used by the RLS
-- policies are deliberately NOT declared here. They are LANGUAGE SQL
-- functions whose bodies PostgreSQL resolves against existing relations at
-- CREATE time, so they can only be created once the accounts and categories
-- tables exist — see section 4.1 below.

-- ----------------------------------------------------------------------------
-- 2. profiles
-- ----------------------------------------------------------------------------
-- One row per authenticated user. `id` is the auth user id itself, so there is
-- no separate `user_id` column and no way to detach a profile from its owner.
-- There is deliberately NO `email` column: Supabase Auth owns the
-- authoritative authentication email (auth.users.email).
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  primary_currency text not null,
  locale text not null,
  timezone text not null,
  role text not null default 'user',
  pay_frequency text,
  monthly_income_expectation numeric,
  financial_preferences jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_name_not_blank
    check (length(btrim(name)) > 0),
  constraint profiles_primary_currency_supported
    check (primary_currency in ('INR', 'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD')),
  constraint profiles_locale_not_blank
    check (length(btrim(locale)) > 0),
  constraint profiles_timezone_not_blank
    check (length(btrim(timezone)) > 0),
  constraint profiles_role_supported
    check (role in ('user', 'admin')),
  constraint profiles_pay_frequency_supported
    check (pay_frequency is null or pay_frequency in ('weekly', 'biweekly', 'monthly', 'yearly', 'irregular', 'other')),
  constraint profiles_monthly_income_expectation_non_negative
    check (monthly_income_expectation is null or monthly_income_expectation >= 0),
  constraint profiles_financial_preferences_is_object
    check (financial_preferences is null or jsonb_typeof(financial_preferences) = 'object')
);

comment on table public.profiles is
  'FinWise user financial profile. Mirrors the UserProfile TypeScript model. Authentication email is owned by auth.users.';
comment on column public.profiles.monthly_income_expectation is
  'Optional expected monthly income used for planning — never a fabricated real number.';
comment on column public.profiles.financial_preferences is
  'JSONB bag of FinancialPreferences (usePrimaryCurrency, riskTolerance, monthStartsOn).';

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. accounts
-- ----------------------------------------------------------------------------
create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  type text not null,
  currency_code text not null,
  initial_balance numeric not null default 0,
  current_balance numeric not null default 0,
  institution_name text,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accounts_name_not_blank
    check (length(btrim(name)) > 0),
  constraint accounts_type_supported
    check (type in ('cash', 'checking', 'savings', 'creditCard', 'investment', 'other')),
  constraint accounts_currency_supported
    check (currency_code in ('INR', 'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD')),
  constraint accounts_initial_balance_non_negative
    check (initial_balance >= 0)
);

comment on table public.accounts is
  'Real account model of the Financial Core. Mirrors the Account TypeScript model.';
comment on column public.accounts.initial_balance is
  'User-entered opening balance at account creation. The only balance input.';
comment on column public.accounts.current_balance is
  'DERIVED value: initial_balance plus every linked transaction effect (see deriveAccountBalances in src/services/financial/accountService.ts). It must always be recomputed from the full transaction set, never incremented in place, so the same effect can never be double-applied.';
comment on constraint accounts_initial_balance_non_negative on public.accounts is
  'Opening balances are entered non-negative, matching parseNonNegativeAmount in the Financial Core. current_balance may legitimately go negative (credit card debt).';

drop trigger if exists accounts_set_updated_at on public.accounts;
create trigger accounts_set_updated_at
  before update on public.accounts
  for each row
  execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 4. categories
-- ----------------------------------------------------------------------------
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  type text not null,
  is_default boolean not null default false,
  is_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  constraint categories_name_not_blank
    check (length(btrim(name)) > 0),
  constraint categories_type_supported
    check (type in ('income', 'expense')),
  -- Natural key: lets an upsert match a default category by (type, name) even
  -- though its application-side id is the canonical slug, not a uuid.
  constraint categories_user_type_name_key
    unique (user_id, type, name)
);

comment on table public.categories is
  'Categorised transaction label. Default categories are seeded per user from the central configuration (src/config/categories.ts) and are extensible by the user.';
comment on column public.categories.is_default is
  'True when the row ships with the product default set (DEFAULT_INCOME_CATEGORY_NAMES / DEFAULT_EXPENSE_CATEGORY_NAMES).';
comment on column public.categories.is_hidden is
  'Hidden categories no longer appear in new-transaction pickers but remain referenced by history.';

-- Category names are unique per user and type, case-insensitively — this
-- mirrors isCategoryNameTaken() in src/services/financial/categoryService.ts.
create unique index if not exists categories_user_type_lower_name_key
  on public.categories (user_id, type, lower(name));

-- ----------------------------------------------------------------------------
-- 4.1 Ownership helper functions
-- ----------------------------------------------------------------------------
-- Predicates used by the RLS WITH CHECK clauses of referencing tables so a
-- user can never point a row at another user's account or category.
--
-- They are LANGUAGE SQL functions: PostgreSQL validates SQL-function bodies at
-- CREATE time (resolving every referenced relation), so they must be created
-- AFTER the accounts (§3) and categories (§4) tables they query — and BEFORE
-- the RLS policies in section 16 that call them.
--
-- They are SECURITY INVOKER, so they are additionally filtered by the RLS
-- policies of the referenced table itself (defence in depth).
create or replace function public.owns_account(p_account_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.accounts as a
    where a.id = p_account_id
      and a.user_id = (select auth.uid())
  );
$$;

comment on function public.owns_account(uuid) is
  'True when the given account belongs to the current authenticated user. Used by RLS WITH CHECK clauses on referencing tables.';

create or replace function public.owns_category(p_category_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.categories as c
    where c.id = p_category_id
      and c.user_id = (select auth.uid())
  );
$$;

comment on function public.owns_category(uuid) is
  'True when the given category belongs to the current authenticated user. Used by RLS WITH CHECK clauses on referencing tables.';

-- ----------------------------------------------------------------------------
-- 5. transactions
-- ----------------------------------------------------------------------------
-- One row per financial event. `amount` is a numeric monetary value in major
-- units — never a formatted currency string. For transfers, `account_id` is
-- the source and `to_account_id` the destination, so both sides of a transfer
-- are represented by a single record (mirrors the Transaction TypeScript model).
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete restrict,
  to_account_id uuid references public.accounts (id) on delete restrict,
  type text not null,
  amount numeric not null,
  currency_code text not null,
  category_id uuid references public.categories (id) on delete set null,
  merchant text,
  description text,
  date date not null,
  notes text,
  is_recurring boolean not null default false,
  recurring_transaction_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transactions_type_supported
    check (type in ('income', 'expense', 'transfer')),
  constraint transactions_amount_positive
    check (amount > 0),
  constraint transactions_currency_supported
    check (currency_code in ('INR', 'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD')),
  -- Transfer semantics: source and destination must differ, a transfer carries
  -- no income/expense category, and income/expense must carry one.
  constraint transactions_transfer_semantics
    check (
      (
        type = 'transfer'
        and to_account_id is not null
        and to_account_id <> account_id
        and category_id is null
      )
      or (
        type in ('income', 'expense')
        and to_account_id is null
        and category_id is not null
      )
    )
);

comment on table public.transactions is
  'Single financial event. Mirrors the Transaction TypeScript model: amount in major units, account_id is the source account, to_account_id the transfer destination.';
comment on column public.transactions.recurring_transaction_id is
  'Set when this transaction was materialised from a recurring definition. The FK is added after recurring_transactions exists.';
comment on constraint transactions_transfer_semantics on public.transactions is
  'income/expense require a category and forbid to_account_id; transfers require a distinct to_account_id and forbid a category.';

drop trigger if exists transactions_set_updated_at on public.transactions;
create trigger transactions_set_updated_at
  before update on public.transactions
  for each row
  execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 6. recurring_transactions
-- ----------------------------------------------------------------------------
-- Deterministic recurring definition. Rendering a page must never create
-- duplicate transactions: occurrences are computed by the pure recurrence
-- engine (src/services/financial/recurringService.ts) and materialising a
-- transaction is an explicit, idempotent backend action.
create table if not exists public.recurring_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete restrict,
  to_account_id uuid references public.accounts (id) on delete restrict,
  type text not null,
  amount numeric not null,
  currency_code text not null,
  category_id uuid references public.categories (id) on delete set null,
  merchant text,
  description text,
  frequency text not null,
  start_date date not null,
  end_date date,
  next_occurrence_at date not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recurring_transactions_type_supported
    check (type in ('income', 'expense', 'transfer')),
  constraint recurring_transactions_amount_positive
    check (amount > 0),
  constraint recurring_transactions_currency_supported
    check (currency_code in ('INR', 'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD')),
  constraint recurring_transactions_frequency_supported
    check (frequency in ('weekly', 'monthly', 'yearly')),
  constraint recurring_transactions_end_date_after_start
    check (end_date is null or end_date >= start_date),
  constraint recurring_transactions_transfer_semantics
    check (
      (
        type = 'transfer'
        and to_account_id is not null
        and to_account_id <> account_id
        and category_id is null
      )
      or (
        type in ('income', 'expense')
        and to_account_id is null
        and category_id is not null
      )
    )
);

comment on table public.recurring_transactions is
  'Deterministic recurring transaction definition. Mirrors the RecurringTransaction TypeScript model (weekly/monthly/yearly only).';
comment on column public.recurring_transactions.next_occurrence_at is
  'Next upcoming occurrence (date). It must only advance through a single idempotent materialisation path so a page render can never duplicate transactions.';
comment on constraint recurring_transactions_end_date_after_start on public.recurring_transactions is
  'end_date is inclusive; when null the schedule runs indefinitely.';

drop trigger if exists recurring_transactions_set_updated_at on public.recurring_transactions;
create trigger recurring_transactions_set_updated_at
  before update on public.recurring_transactions
  for each row
  execute function public.set_updated_at();

-- The transactions -> recurring_transactions link is resolved after both
-- tables exist. ON DELETE SET NULL matches domain behaviour where deleting a
-- schedule never deletes real transaction history.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'transactions_recurring_transaction_id_fkey'
      and conrelid = 'public.transactions'::regclass
  ) then
    alter table public.transactions
      add constraint transactions_recurring_transaction_id_fkey
      foreign key (recurring_transaction_id)
      references public.recurring_transactions (id)
      on delete set null;
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 7. budgets
-- ----------------------------------------------------------------------------
create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete restrict,
  currency_code text not null,
  limit_amount numeric not null,
  spent numeric not null default 0,
  period text not null,
  start_date date not null,
  end_date date not null,
  created_at timestamptz not null default now(),
  constraint budgets_currency_supported
    check (currency_code in ('INR', 'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD')),
  constraint budgets_limit_amount_positive
    check (limit_amount > 0),
  constraint budgets_spent_non_negative
    check (spent >= 0),
  constraint budgets_period_supported
    check (period in ('weekly', 'monthly', 'yearly')),
  constraint budgets_period_dates_ordered
    check (end_date >= start_date)
);

comment on table public.budgets is
  'Planned spending limit per category and period. Mirrors the Budget TypeScript model (limit / spent / period / startDate / endDate).';
comment on column public.budgets.spent is
  'DERIVED value: the exact sum of real expense transactions in this category inside the inclusive period (see budgetSpentFor / withDerivedBudgetSpending in src/services/financial/budgetService.ts). Never increment it in place, so spending can never be double-counted.';

-- One plan per user + category + period + start date, matching the duplicate
-- rule in validateBudgetInput() so Safe-to-Spend budget commitments never
-- double-count allocations.
create unique index if not exists budgets_user_category_period_start_key
  on public.budgets (user_id, category_id, period, start_date);

-- ----------------------------------------------------------------------------
-- 8. goals
-- ----------------------------------------------------------------------------
create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  target_amount numeric not null,
  current_amount numeric not null default 0,
  currency_code text not null,
  target_date date,
  category_id uuid references public.categories (id) on delete set null,
  status text not null,
  created_at timestamptz not null default now(),
  constraint goals_title_not_blank
    check (length(btrim(title)) > 0),
  constraint goals_target_amount_positive
    check (target_amount > 0),
  constraint goals_current_amount_non_negative
    check (current_amount >= 0),
  constraint goals_currency_supported
    check (currency_code in ('INR', 'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD')),
  constraint goals_status_supported
    check (status in ('active', 'paused', 'completed', 'archived'))
);

comment on table public.goals is
  'Savings goal. Mirrors the Goal TypeScript model.';
comment on column public.goals.current_amount is
  'Amount saved so far. Progress is derived (goalProgress in src/intelligence/finance.ts); the stored amount is the user-facing contribution total.';

-- ----------------------------------------------------------------------------
-- 9. financial_snapshots
-- ----------------------------------------------------------------------------
-- The Financial Digital Twin's point-in-time memory. Every value here is
-- produced by the deterministic engine (src/intelligence/finance.ts), never by
-- a generative model.
create table if not exists public.financial_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  captured_at timestamptz not null default now(),
  net_worth numeric not null,
  cash_flow numeric not null,
  safe_to_spend numeric not null,
  financial_health_score numeric not null,
  income numeric not null,
  expenses numeric not null,
  savings_rate numeric not null,
  debt numeric not null,
  currency_code text not null,
  constraint financial_snapshots_currency_supported
    check (currency_code in ('INR', 'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD')),
  -- calculateFinancialHealthScore() always clamps to 0..100.
  constraint financial_snapshots_health_score_range
    check (financial_health_score >= 0 and financial_health_score <= 100),
  -- computeMonthlyFlow() clamps the savings rate to 0..100.
  constraint financial_snapshots_savings_rate_range
    check (savings_rate >= 0 and savings_rate <= 100),
  constraint financial_snapshots_income_non_negative
    check (income >= 0),
  constraint financial_snapshots_expenses_non_negative
    check (expenses >= 0),
  -- safeToSpend() clamps the result with Math.max(0, ...).
  constraint financial_snapshots_safe_to_spend_non_negative
    check (safe_to_spend >= 0),
  -- computeNetWorthBreakdown() derives debt with Math.abs(), so debt is never
  -- negative; net_worth and cash_flow may legitimately be negative.
  constraint financial_snapshots_debt_non_negative
    check (debt >= 0)
);

comment on table public.financial_snapshots is
  'Point-in-time Financial Digital Twin snapshot. Mirrors the FinancialSnapshot TypeScript model. Values are deterministic engine output.';

-- ----------------------------------------------------------------------------
-- 10. financial_insights
-- ----------------------------------------------------------------------------
create table if not exists public.financial_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null,
  title text not null,
  summary text not null,
  details text not null,
  confidence numeric not null,
  category text,
  created_at timestamptz not null default now(),
  constraint financial_insights_type_supported
    check (type in ('alert', 'optimization', 'forecast', 'risk', 'milestone')),
  constraint financial_insights_title_not_blank
    check (length(btrim(title)) > 0),
  constraint financial_insights_summary_not_blank
    check (length(btrim(summary)) > 0),
  constraint financial_insights_confidence_range
    check (confidence >= 0 and confidence <= 1)
);

comment on table public.financial_insights is
  'Explainable insight produced by the deterministic engine and (from Phase 4) explained by an AI provider through the secure backend boundary. Mirrors the FinancialInsight TypeScript model.';

-- ----------------------------------------------------------------------------
-- 11. life_events
-- ----------------------------------------------------------------------------
-- Schema support only. The Life Event Lab itself lands in a later phase; the
-- domain model already exists (LifeEvent in src/types/financial.ts).
create table if not exists public.life_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null,
  title text not null,
  date date,
  amount numeric,
  currency_code text,
  notes text,
  constraint life_events_type_supported
    check (type in ('buy_car', 'buy_house', 'marriage', 'baby', 'college', 'vacation', 'move', 'new_job', 'job_loss', 'start_business', 'custom')),
  constraint life_events_title_not_blank
    check (length(btrim(title)) > 0),
  constraint life_events_amount_positive
    check (amount is null or amount > 0),
  constraint life_events_currency_supported
    check (currency_code is null or currency_code in ('INR', 'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD')),
  -- A monetary amount is meaningless without its currency code.
  constraint life_events_currency_required_with_amount
    check (amount is null or currency_code is not null)
);

comment on table public.life_events is
  'Life event linked to a financial decision. Mirrors the LifeEvent TypeScript model. Schema foundation only — Life Event Lab logic is a later phase.';

-- ----------------------------------------------------------------------------
-- 12. scenarios
-- ----------------------------------------------------------------------------
create table if not exists public.scenarios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text not null,
  assumptions jsonb not null,
  projected_net_worth numeric not null,
  confidence numeric not null,
  created_at timestamptz not null default now(),
  constraint scenarios_name_not_blank
    check (length(btrim(name)) > 0),
  constraint scenarios_description_not_blank
    check (length(btrim(description)) > 0),
  constraint scenarios_assumptions_is_object
    check (jsonb_typeof(assumptions) = 'object'),
  constraint scenarios_confidence_range
    check (confidence >= 0 and confidence <= 1)
);

comment on table public.scenarios is
  'Financial Time Machine scenario. Mirrors the Scenario TypeScript model. projected_net_worth may be negative and is always deterministic engine output.';

-- ----------------------------------------------------------------------------
-- 13. decisions
-- ----------------------------------------------------------------------------
create table if not exists public.decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  question text not null,
  answer text not null,
  affordability_score numeric not null,
  explanation text not null,
  created_at timestamptz not null default now(),
  constraint decisions_question_not_blank
    check (length(btrim(question)) > 0),
  constraint decisions_answer_supported
    check (answer in ('yes', 'no', 'maybe')),
  constraint decisions_explanation_not_blank
    check (length(btrim(explanation)) > 0),
  -- FinWise scores are 0..100 throughout the domain (financialHealthScore,
  -- goal progress). Confidence values stay 0..1.
  constraint decisions_affordability_score_range
    check (affordability_score >= 0 and affordability_score <= 100)
);

comment on table public.decisions is
  'Decision Intelligence record. Mirrors the Decision TypeScript model. The Decision Intelligence feature itself is a later phase.';

-- ----------------------------------------------------------------------------
-- 14. financial_memories
-- ----------------------------------------------------------------------------
create table if not exists public.financial_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  theme text not null,
  title text not null,
  description text not null,
  context jsonb not null,
  created_at timestamptz not null default now(),
  constraint financial_memories_theme_supported
    check (theme in ('spending', 'goal', 'risk', 'habit', 'milestone')),
  constraint financial_memories_title_not_blank
    check (length(btrim(title)) > 0),
  constraint financial_memories_description_not_blank
    check (length(btrim(description)) > 0),
  constraint financial_memories_context_is_object
    check (jsonb_typeof(context) = 'object')
);

comment on table public.financial_memories is
  'Long-term financial memory of the Financial Digital Twin. Mirrors the FinancialMemory TypeScript model. Append-only in practice: memories are written, not rewritten.';

-- ============================================================================
-- 15. Indexes
-- ============================================================================
-- RLS policies filter every user-owned table by user_id, so user_id is indexed
-- on all of them. The remaining indexes cover the query shapes the Financial
-- Core and the deterministic engine actually perform.

-- profiles: primary key is the auth uid, no extra index required.

create index if not exists accounts_user_id_idx
  on public.accounts (user_id);
create index if not exists accounts_user_id_is_archived_idx
  on public.accounts (user_id, is_archived);

create index if not exists categories_user_id_idx
  on public.categories (user_id);
create index if not exists categories_user_id_type_idx
  on public.categories (user_id, type);

create index if not exists transactions_user_id_idx
  on public.transactions (user_id);
create index if not exists transactions_account_id_idx
  on public.transactions (account_id);
create index if not exists transactions_to_account_id_idx
  on public.transactions (to_account_id);
create index if not exists transactions_category_id_idx
  on public.transactions (category_id);
create index if not exists transactions_date_idx
  on public.transactions (date);
create index if not exists transactions_user_id_date_idx
  on public.transactions (user_id, date desc);
create index if not exists transactions_recurring_transaction_id_idx
  on public.transactions (recurring_transaction_id);

create index if not exists recurring_transactions_user_id_idx
  on public.recurring_transactions (user_id);
create index if not exists recurring_transactions_account_id_idx
  on public.recurring_transactions (account_id);
create index if not exists recurring_transactions_to_account_id_idx
  on public.recurring_transactions (to_account_id);
create index if not exists recurring_transactions_category_id_idx
  on public.recurring_transactions (category_id);
create index if not exists recurring_transactions_next_occurrence_at_idx
  on public.recurring_transactions (next_occurrence_at);
-- Scheduler-friendly: "which active schedules are due?"
create index if not exists recurring_transactions_user_id_is_active_next_occurrence_at_idx
  on public.recurring_transactions (user_id, is_active, next_occurrence_at);

create index if not exists budgets_user_id_idx
  on public.budgets (user_id);
create index if not exists budgets_category_id_idx
  on public.budgets (category_id);
create index if not exists budgets_user_id_start_date_idx
  on public.budgets (user_id, start_date);

create index if not exists goals_user_id_idx
  on public.goals (user_id);
create index if not exists goals_status_idx
  on public.goals (status);
create index if not exists goals_category_id_idx
  on public.goals (category_id);
create index if not exists goals_user_id_status_idx
  on public.goals (user_id, status);

create index if not exists financial_snapshots_user_id_captured_at_idx
  on public.financial_snapshots (user_id, captured_at desc);

create index if not exists financial_insights_user_id_created_at_idx
  on public.financial_insights (user_id, created_at desc);
create index if not exists financial_insights_user_id_type_idx
  on public.financial_insights (user_id, type);

create index if not exists life_events_user_id_idx
  on public.life_events (user_id);
create index if not exists life_events_user_id_date_idx
  on public.life_events (user_id, date desc);

create index if not exists scenarios_user_id_idx
  on public.scenarios (user_id);
create index if not exists scenarios_user_id_created_at_idx
  on public.scenarios (user_id, created_at desc);

create index if not exists decisions_user_id_idx
  on public.decisions (user_id);
create index if not exists decisions_user_id_created_at_idx
  on public.decisions (user_id, created_at desc);

create index if not exists financial_memories_user_id_idx
  on public.financial_memories (user_id);
create index if not exists financial_memories_user_id_theme_idx
  on public.financial_memories (user_id, theme);
create index if not exists financial_memories_user_id_created_at_idx
  on public.financial_memories (user_id, created_at desc);

-- ============================================================================
-- 16. Row Level Security
-- ============================================================================
-- Every user-owned table has RLS enabled. Without a matching policy PostgreSQL
-- denies by default, so nothing here is readable across users — and nothing is
-- readable by the anonymous role at all.
--
-- All policies are:
--   * PERMISSIVE (default) but scoped `to authenticated`
--   * written against `(select auth.uid())` so the value is evaluated once per
--     statement instead of once per row
--   * never dependent on user-supplied input or request headers

alter table public.profiles enable row level security;
alter table public.accounts enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;
alter table public.recurring_transactions enable row level security;
alter table public.budgets enable row level security;
alter table public.goals enable row level security;
alter table public.financial_snapshots enable row level security;
alter table public.financial_insights enable row level security;
alter table public.life_events enable row level security;
alter table public.scenarios enable row level security;
alter table public.decisions enable row level security;
alter table public.financial_memories enable row level security;

-- ----------------------------------------------------------------------------
-- 16.1 profiles
-- ----------------------------------------------------------------------------
-- profiles is special: the primary key IS the owner. A user can only ever see
-- and touch the row whose id equals their auth uid. There is deliberately no
-- DELETE policy — removing a profile is part of deleting the auth user, and
-- the FK cascade from auth.users handles it.
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()));

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own
  on public.profiles
  for insert
  to authenticated
  with check (id = (select auth.uid()));

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- 16.2 accounts
-- ----------------------------------------------------------------------------
drop policy if exists accounts_select_own on public.accounts;
create policy accounts_select_own
  on public.accounts
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists accounts_insert_own on public.accounts;
create policy accounts_insert_own
  on public.accounts
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists accounts_update_own on public.accounts;
create policy accounts_update_own
  on public.accounts
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists accounts_delete_own on public.accounts;
create policy accounts_delete_own
  on public.accounts
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- 16.3 categories
-- ----------------------------------------------------------------------------
drop policy if exists categories_select_own on public.categories;
create policy categories_select_own
  on public.categories
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists categories_insert_own on public.categories;
create policy categories_insert_own
  on public.categories
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists categories_update_own on public.categories;
create policy categories_update_own
  on public.categories
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists categories_delete_own on public.categories;
create policy categories_delete_own
  on public.categories
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- 16.4 transactions
-- ----------------------------------------------------------------------------
-- The WITH CHECK clauses also verify that the referenced account(s) and
-- category belong to the same user. Without this a caller could point a row at
-- another user's account/category and corrupt their derived balances.
drop policy if exists transactions_select_own on public.transactions;
create policy transactions_select_own
  on public.transactions
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists transactions_insert_own on public.transactions;
create policy transactions_insert_own
  on public.transactions
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and public.owns_account(account_id)
    and (to_account_id is null or public.owns_account(to_account_id))
    and (category_id is null or public.owns_category(category_id))
  );

drop policy if exists transactions_update_own on public.transactions;
create policy transactions_update_own
  on public.transactions
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and public.owns_account(account_id)
    and (to_account_id is null or public.owns_account(to_account_id))
    and (category_id is null or public.owns_category(category_id))
  );

drop policy if exists transactions_delete_own on public.transactions;
create policy transactions_delete_own
  on public.transactions
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- 16.5 recurring_transactions
-- ----------------------------------------------------------------------------
drop policy if exists recurring_transactions_select_own on public.recurring_transactions;
create policy recurring_transactions_select_own
  on public.recurring_transactions
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists recurring_transactions_insert_own on public.recurring_transactions;
create policy recurring_transactions_insert_own
  on public.recurring_transactions
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and public.owns_account(account_id)
    and (to_account_id is null or public.owns_account(to_account_id))
    and (category_id is null or public.owns_category(category_id))
  );

drop policy if exists recurring_transactions_update_own on public.recurring_transactions;
create policy recurring_transactions_update_own
  on public.recurring_transactions
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and public.owns_account(account_id)
    and (to_account_id is null or public.owns_account(to_account_id))
    and (category_id is null or public.owns_category(category_id))
  );

drop policy if exists recurring_transactions_delete_own on public.recurring_transactions;
create policy recurring_transactions_delete_own
  on public.recurring_transactions
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- 16.6 budgets
-- ----------------------------------------------------------------------------
drop policy if exists budgets_select_own on public.budgets;
create policy budgets_select_own
  on public.budgets
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists budgets_insert_own on public.budgets;
create policy budgets_insert_own
  on public.budgets
  for insert
  to authenticated
  with check (user_id = (select auth.uid()) and public.owns_category(category_id));

drop policy if exists budgets_update_own on public.budgets;
create policy budgets_update_own
  on public.budgets
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.owns_category(category_id));

drop policy if exists budgets_delete_own on public.budgets;
create policy budgets_delete_own
  on public.budgets
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- 16.7 goals
-- ----------------------------------------------------------------------------
drop policy if exists goals_select_own on public.goals;
create policy goals_select_own
  on public.goals
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists goals_insert_own on public.goals;
create policy goals_insert_own
  on public.goals
  for insert
  to authenticated
  with check (user_id = (select auth.uid()) and (category_id is null or public.owns_category(category_id)));

drop policy if exists goals_update_own on public.goals;
create policy goals_update_own
  on public.goals
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (category_id is null or public.owns_category(category_id)));

drop policy if exists goals_delete_own on public.goals;
create policy goals_delete_own
  on public.goals
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- 16.8 Intelligence tables
-- ----------------------------------------------------------------------------
-- financial_snapshots: append-only history. No UPDATE policy is defined so a
-- captured snapshot cannot be rewritten after the fact; DELETE stays available
-- so a user can remove their own history.
drop policy if exists financial_snapshots_select_own on public.financial_snapshots;
create policy financial_snapshots_select_own
  on public.financial_snapshots
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists financial_snapshots_insert_own on public.financial_snapshots;
create policy financial_snapshots_insert_own
  on public.financial_snapshots
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists financial_snapshots_delete_own on public.financial_snapshots;
create policy financial_snapshots_delete_own
  on public.financial_snapshots
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- financial_insights
drop policy if exists financial_insights_select_own on public.financial_insights;
create policy financial_insights_select_own
  on public.financial_insights
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists financial_insights_insert_own on public.financial_insights;
create policy financial_insights_insert_own
  on public.financial_insights
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists financial_insights_update_own on public.financial_insights;
create policy financial_insights_update_own
  on public.financial_insights
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists financial_insights_delete_own on public.financial_insights;
create policy financial_insights_delete_own
  on public.financial_insights
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- life_events
drop policy if exists life_events_select_own on public.life_events;
create policy life_events_select_own
  on public.life_events
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists life_events_insert_own on public.life_events;
create policy life_events_insert_own
  on public.life_events
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists life_events_update_own on public.life_events;
create policy life_events_update_own
  on public.life_events
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists life_events_delete_own on public.life_events;
create policy life_events_delete_own
  on public.life_events
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- scenarios
drop policy if exists scenarios_select_own on public.scenarios;
create policy scenarios_select_own
  on public.scenarios
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists scenarios_insert_own on public.scenarios;
create policy scenarios_insert_own
  on public.scenarios
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists scenarios_update_own on public.scenarios;
create policy scenarios_update_own
  on public.scenarios
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists scenarios_delete_own on public.scenarios;
create policy scenarios_delete_own
  on public.scenarios
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- decisions
drop policy if exists decisions_select_own on public.decisions;
create policy decisions_select_own
  on public.decisions
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists decisions_insert_own on public.decisions;
create policy decisions_insert_own
  on public.decisions
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists decisions_update_own on public.decisions;
create policy decisions_update_own
  on public.decisions
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists decisions_delete_own on public.decisions;
create policy decisions_delete_own
  on public.decisions
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- financial_memories
drop policy if exists financial_memories_select_own on public.financial_memories;
create policy financial_memories_select_own
  on public.financial_memories
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists financial_memories_insert_own on public.financial_memories;
create policy financial_memories_insert_own
  on public.financial_memories
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists financial_memories_update_own on public.financial_memories;
create policy financial_memories_update_own
  on public.financial_memories
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists financial_memories_delete_own on public.financial_memories;
create policy financial_memories_delete_own
  on public.financial_memories
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- ============================================================================
-- 17. Privileges
-- ============================================================================
-- RLS decides WHICH rows a role may touch; privileges decide WHICH tables it
-- may touch at all. Both are locked down here:
--   * anon gets nothing — financial data is never reachable unauthenticated
--   * authenticated gets DML on the user-owned tables (RLS then narrows it to
--     the caller's own rows)
--   * service_role is the server-side boundary and bypasses RLS by design;
--     it is never used from the frontend
do $$
declare
  owned_table text;
  owned_tables text[] := array[
    'profiles',
    'accounts',
    'categories',
    'transactions',
    'recurring_transactions',
    'budgets',
    'goals',
    'financial_snapshots',
    'financial_insights',
    'life_events',
    'scenarios',
    'decisions',
    'financial_memories'
  ];
begin
  foreach owned_table in array owned_tables loop
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on table public.%I from anon', owned_table);
    end if;

    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format(
        'grant select, insert, update, delete on table public.%I to authenticated',
        owned_table
      );
    end if;

    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant all on table public.%I to service_role', owned_table);
    end if;
  end loop;
end
$$;

-- Trigger-only functions and the seeding helper are never reachable through the
-- API surface except where explicitly granted at the end of this migration.

-- Ownership predicates are required by the RLS policies above, so the
-- authenticated role must be able to execute them.
grant execute on function public.owns_account(uuid) to authenticated;
grant execute on function public.owns_category(uuid) to authenticated;

-- ============================================================================
-- 18. Default category seeding
-- ============================================================================
-- The product ships a fixed default category set. These names and types are a
-- 1:1 mirror of src/config/categories.ts and must be kept in step with it:
--
--   DEFAULT_INCOME_CATEGORY_NAMES  -> 'Salary','Freelance','Business','Investment','Gift','Other'
--   DEFAULT_EXPENSE_CATEGORY_NAMES -> 'Housing','Food','Transportation','Shopping','Entertainment',
--                                     'Health','Education','Subscriptions','Travel','Bills',
--                                     'Personal','Other'
--
-- Default categories are identified by their database uuid, exactly like every
-- other entity, and are flagged `is_default = true`. Compatibility with the
-- central configuration is structural: the same names and types are seeded, so
-- src/config/categories.ts stays the single source of truth for which defaults
-- exist. The natural key (user_id, type, name) lets an upsert adopt a category
-- that was minted with a Phase 2 slug id without creating a duplicate.
create or replace function public.seed_default_categories(p_user_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  income_names text[] := array['Salary', 'Freelance', 'Business', 'Investment', 'Gift', 'Other'];
  expense_names text[] := array[
    'Housing', 'Food', 'Transportation', 'Shopping', 'Entertainment', 'Health',
    'Education', 'Subscriptions', 'Travel', 'Bills', 'Personal', 'Other'
  ];
  category_name text;
begin
  if p_user_id is null then
    raise exception 'seed_default_categories requires a user id';
  end if;

  foreach category_name in array income_names loop
    insert into public.categories (user_id, name, type, is_default, is_hidden)
    values (p_user_id, category_name, 'income', true, false)
    on conflict do nothing;
  end loop;

  foreach category_name in array expense_names loop
    insert into public.categories (user_id, name, type, is_default, is_hidden)
    values (p_user_id, category_name, 'expense', true, false)
    on conflict do nothing;
  end loop;
end;
$$;

comment on function public.seed_default_categories(uuid) is
  'Seeds the central default category set (mirrors src/config/categories.ts) for one user. Idempotent: existing rows are left untouched.';

-- ============================================================================
-- 19. Profile bootstrap
-- ============================================================================
-- Creates the matching public.profiles row (and the default categories) as soon
-- as Supabase Auth creates an auth.users row. This is backend plumbing, NOT
-- authentication: Supabase Auth owns the email, password, and session.
--
-- SECURITY DEFINER is required because auth.users is not writable by client
-- roles. The function therefore hard-codes safe defaults instead of trusting
-- raw_user_meta_data for CHECK-constrained columns, and it swallows its own
-- failures so a profile-bootstrap problem can never block a signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_name text;
begin
  resolved_name := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'name', '')), '');
  if resolved_name is null then
    resolved_name := nullif(btrim(split_part(coalesce(new.email, ''), '@', 1)), '');
  end if;
  if resolved_name is null then
    resolved_name := 'FinWise user';
  end if;

  insert into public.profiles (id, name, primary_currency, locale, timezone, role)
  values (new.id, resolved_name, 'INR', 'en-IN', 'UTC', 'user')
  on conflict (id) do nothing;

  perform public.seed_default_categories(new.id);

  return new;
exception
  when others then
    raise warning 'FinWise profile bootstrap failed for user %: %', new.id, sqlerrm;
    return new;
end;
$$;

comment on function public.handle_new_user() is
  'AFTER INSERT trigger on auth.users: bootstraps the FinWise profile row and the default category set for a new authenticated user.';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ============================================================================
-- 20. Function privileges
-- ============================================================================
-- Declared last, because every function must exist before its privileges can be
-- changed.
--
-- `set_updated_at` and `handle_new_user` are trigger-only: a trigger fires them
-- without any EXECUTE check, so revoking them removes API surface without
-- breaking the triggers.
revoke all on function public.set_updated_at() from public;
revoke all on function public.handle_new_user() from public;

-- The seeding helper is the one function a client may legitimately call, so the
-- authenticated role keeps EXECUTE. It is SECURITY INVOKER, so the categories
-- INSERT policy still restricts it to auth.uid().
grant execute on function public.seed_default_categories(uuid) to authenticated;

commit;
