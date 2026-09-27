import type {
  Account,
  Budget,
  Category,
  CurrencyCode,
  DashboardMetrics,
  FinancialSnapshot,
  Goal,
  GoalProgressInfo,
  MonthlyFlow,
  NetWorthBreakdown,
  PayFrequency,
  RecurringTransaction,
  SafeToSpendBreakdown,
  Transaction,
  UserProfile,
} from '../types/financial';
import type { Evidence, InsufficientDataReason, IntelligenceSection, SourceRef } from '../types/intelligence';
import {
  ALL_PERIOD_KEY,
  EVIDENCE_RULE_VERSION,
  buildEvidence,
  insufficient,
  periodKeyOf,
  sharePercent,
  sourceRef,
} from './evidence';
import { available, unavailable } from './section';
import { goalProgress } from './finance';
import { fromMinorUnits, roundMoney, subtractMoney, sumMoney, toMinorUnits } from '../lib/money';
import { toISODate } from '../lib/date';

/**
 * Financial Digital Twin assembly (Phase 4B).
 *
 * Pure and deterministic — no storage, no network, no AI, and the clock is
 * always injected (`now`). Every builder returns an `IntelligenceSection`:
 * either `available` with mandatory evidence, or `insufficient_data` with an
 * explicit, user-facing reason. No section ever presents a placeholder that
 * looks like a real financial figure.
 *
 * Layering (Phase 4A §6):
 *   * A. Derived twin — recomputed from persisted data plus the authoritative
 *     engine output (`DashboardMetrics`), never stored.
 *   * B. Persisted twin memory — snapshot drafts for `financial_snapshots`
 *     with a documented material-change capture predicate.
 *
 * Engine outputs are reused verbatim (`metrics.*`, `goalProgress`), never
 * recomputed — every calculation lives in exactly one module.
 */

/** Evidence lists at most this many transaction pointers, in stable date order. */
export const MAX_TRANSACTION_SOURCE_REFS = 100;

/** Snapshot capture: net worth recapture band (relative, 1%). */
export const SNAPSHOT_NET_WORTH_MATERIAL_BAND = 0.01;
/** Snapshot capture: Safe-to-Spend recapture band (relative, 1%). */
export const SNAPSHOT_SAFE_TO_SPEND_MATERIAL_BAND = 0.01;
/** Snapshot capture: health score recapture band (absolute points). */
export const SNAPSHOT_HEALTH_SCORE_MATERIAL_BAND = 1;

/** Everything the twin builders consume. Pure inputs only — no I/O anywhere. */
export interface TwinDerivationInput {
  /** Injected clock; the twin never reads the clock implicitly. */
  now: Date;
  profile: UserProfile | null;
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  budgets: Budget[];
  goals: Goal[];
  recurringTransactions: RecurringTransaction[];
  /** Authoritative engine output — reused as-is, never recomputed here. */
  metrics: DashboardMetrics;
}

/* --------------------------------------------------------------------------- */
/* shared helpers                                                               */
/* --------------------------------------------------------------------------- */

function twinEvidence(args: {
  ruleId: string;
  periodKey: string;
  computedAt: string;
  metrics: Record<string, number>;
  sourceRefs: readonly SourceRef[];
}): Evidence {
  return buildEvidence({
    ruleId: args.ruleId,
    ruleVersion: EVIDENCE_RULE_VERSION,
    periodKey: args.periodKey,
    computedAt: args.computedAt,
    metrics: args.metrics,
    thresholds: {},
    sourceRefs: args.sourceRefs,
  });
}

/** Insufficient twin branch: an explicit reason, never a fabricated value. */
function insufficientTwin<T>(reasons: readonly InsufficientDataReason[]): IntelligenceSection<T> {
  return unavailable<T>(reasons);
}

/** Stable date-then-id order so evidence is reproducible across renders. */
function byStableOrder(a: { date: string; id: string }, b: { date: string; id: string }): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Bounded, deterministic transaction pointers for evidence. */
function boundedTransactionRefs(
  transactions: readonly Transaction[],
): { refs: SourceRef[]; truncated: boolean } {
  const ordered = [...transactions].sort(byStableOrder);
  return {
    refs: ordered
      .slice(0, MAX_TRANSACTION_SOURCE_REFS)
      .map((transaction) => sourceRef('transactions', transaction.id)),
    truncated: ordered.length > MAX_TRANSACTION_SOURCE_REFS,
  };
}

function categoryName(categories: readonly Category[], categoryId: string | null | undefined): string {
  if (categoryId === null || categoryId === undefined) return 'Uncategorized';
  const category = categories.find((item) => item.id === categoryId);
  return category?.name ?? 'Uncategorized';
}

function recurringLabel(item: RecurringTransaction): string {
  return item.merchant?.trim() || item.description?.trim() || `Recurring ${item.type}`;
}

/** Monthly projection of one recurring item (mirrors the engine's aggregate semantics). */
function recurringMonthlyEquivalent(item: RecurringTransaction): number {
  const minor = toMinorUnits(item.amount);
  const projected =
    item.frequency === 'weekly' ? (minor * 52) / 12 : item.frequency === 'yearly' ? minor / 12 : minor;
  return fromMinorUnits(Math.round(projected));
}

/* --------------------------------------------------------------------------- */
/* A. State — the twin's point-in-time representation                           */
/* --------------------------------------------------------------------------- */

export interface TwinStateData {
  /** Profile currency, or null until the profile exists (UI falls back to the app default). */
  currencyCode: CurrencyCode | null;
  identity: {
    profileName: string | null;
    payFrequency: PayFrequency | null;
    expectedMonthlyIncome: number | null;
  };
  accounts: { total: number; active: number; byType: Record<string, number> };
  netWorth: NetWorthBreakdown | null;
  monthlyFlow: MonthlyFlow | null;
  monthlySurplus: number | null;
  recurringCommitments: { monthlyTotal: number | null; activeCount: number };
  budgets: { count: number; committedMonthly: number | null };
  goals: { activeCount: number; aggregateProgress: number | null };
}

/**
 * "Where am I?" — identity, accounts, this month's flow and commitments.
 * Engine outputs (`metrics.netWorth`, `metrics.monthly`, `metrics.safeToSpend`,
 * `metrics.goalProgress`) are reused verbatim; nothing is recomputed.
 */
export function buildFinancialSnapshotSummary(input: TwinDerivationInput): IntelligenceSection<TwinStateData> {
  const { now, profile, accounts, transactions, budgets, goals, recurringTransactions, metrics } = input;
  const computedAt = now.toISOString();

  if (accounts.length === 0 && transactions.length === 0) {
    return insufficientTwin<TwinStateData>([
      insufficient('no_accounts', 'Add an account so your twin can describe your financial state.', ['accounts']),
      insufficient(
        'no_activity',
        'Your twin needs accounts or transactions before a state summary exists.',
        ['accounts', 'transactions'],
      ),
    ]);
  }

  const activeAccounts = accounts.filter((account) => !account.isArchived);
  const byType = accounts.reduce<Record<string, number>>((totals, account) => {
    totals[account.type] = (totals[account.type] ?? 0) + 1;
    return totals;
  }, {});

  const currencyCount = new Set(accounts.map((account) => account.currencyCode)).size;
  const transactionRefs = boundedTransactionRefs(transactions);
  const monthlySurplus = metrics.monthly ? subtractMoney(metrics.monthly.income, metrics.monthly.expenses) : null;

  const notes: string[] = [];
  if (currencyCount > 1) {
    notes.push(`Amounts combine ${currencyCount} account currencies exactly as entered (no conversion is applied).`);
  }
  if (profile === null) {
    notes.push('Add your profile to personalise the twin with your currency and pay frequency.');
  }
  if (metrics.monthly === null) {
    notes.push('No transactions yet, so this month\u2019s income and expenses are not derived yet.');
  }
  if (transactionRefs.truncated) {
    notes.push(
      `Evidence lists the first ${MAX_TRANSACTION_SOURCE_REFS} transactions in date order (of ${transactions.length}).`,
    );
  }

  const data: TwinStateData = {
    currencyCode: profile?.primaryCurrency ?? null,
    identity: {
      profileName: profile?.name ?? null,
      payFrequency: profile?.payFrequency ?? null,
      expectedMonthlyIncome: profile?.monthlyIncomeExpectation ?? null,
    },
    accounts: { total: accounts.length, active: activeAccounts.length, byType },
    netWorth: metrics.netWorth,
    monthlyFlow: metrics.monthly,
    monthlySurplus,
    recurringCommitments: {
      monthlyTotal: metrics.safeToSpend?.committedBills ?? null,
      activeCount: recurringTransactions.filter((item) => item.isActive).length,
    },
    budgets: { count: budgets.length, committedMonthly: metrics.safeToSpend?.budgetCommitments ?? null },
    goals: {
      activeCount: metrics.goalProgress.activeGoalCount,
      aggregateProgress: metrics.goalProgress.aggregate,
    },
  };

  const evidence = twinEvidence({
    ruleId: 'twin.state',
    periodKey: periodKeyOf(now),
    computedAt,
    metrics: {
      accounts_total: accounts.length,
      accounts_active: activeAccounts.length,
      transactions: transactions.length,
      net_worth: metrics.netWorth?.netWorth ?? 0,
      cash: metrics.netWorth?.cash ?? 0,
      investments: metrics.netWorth?.investments ?? 0,
      debt: metrics.netWorth?.debt ?? 0,
      income_month: metrics.monthly?.income ?? 0,
      expenses_month: metrics.monthly?.expenses ?? 0,
      monthly_surplus: monthlySurplus ?? 0,
      savings_rate: metrics.monthly?.savingsRate ?? 0,
      recurring_monthly: metrics.safeToSpend?.committedBills ?? 0,
      budgets_committed_monthly: metrics.safeToSpend?.budgetCommitments ?? 0,
      budgets: budgets.length,
      goals_active: metrics.goalProgress.activeGoalCount,
      goal_progress: metrics.goalProgress.aggregate ?? 0,
    },
    sourceRefs: [
      ...accounts.map((account) => sourceRef('accounts', account.id)),
      ...(profile ? [sourceRef('profile', profile.id)] : []),
      ...budgets.map((budget) => sourceRef('budgets', budget.id)),
      ...goals.map((goal) => sourceRef('goals', goal.id)),
      ...recurringTransactions.map((item) => sourceRef('recurring_transactions', item.id)),
      ...transactionRefs.refs,
    ],
  });

  return available(data, evidence, notes);
}

/* --------------------------------------------------------------------------- */
/* B. Behaviour — what the user actually does                                   */
/* --------------------------------------------------------------------------- */

export interface TwinCategorySpend {
  /** Null when the expense has no category (always labelled, never anonymous). */
  categoryId: string | null;
  label: string;
  total: number;
  /** Share of the window's total expenses, 0–100 with one decimal. */
  shareOfExpenses: number;
}

export interface TwinBehaviourData {
  /** The local month the behaviour describes (`YYYY-MM`). */
  periodKey: string;
  expenseCount: number;
  expenseTotal: number;
  spendingByCategory: TwinCategorySpend[];
  /** Active recurring commitments projected monthly (engine value, reused). */
  recurringMonthlyEquivalent: number | null;
  recurringShareOfExpenses: number | null;
  savingsRate: number | null;
  monthlySurplus: number | null;
  transactionCount: number;
}

/**
 * "How do I behave?" — current-month expense structure, recurring weight and
 * savings outcome. Category totals use `classifySpending` semantics (sum
 * expenses per category, largest first) for the twin's own window.
 */
export function buildBehaviourSummary(input: TwinDerivationInput): IntelligenceSection<TwinBehaviourData> {
  const { now, categories, transactions, metrics } = input;
  const computedAt = now.toISOString();
  const monthKey = periodKeyOf(now);

  const monthExpenses = transactions.filter(
    (transaction) => transaction.type === 'expense' && transaction.date.startsWith(monthKey),
  );

  if (monthExpenses.length === 0) {
    return insufficientTwin<TwinBehaviourData>([
      insufficient(
        'no_expenses',
        'No expenses are recorded for this month yet, so there is no behaviour to describe.',
        ['transactions'],
      ),
    ]);
  }

  const expenseTotal = sumMoney(monthExpenses.map((transaction) => transaction.amount));
  const totalsByCategory = new Map<string | null, { total: number; count: number }>();
  for (const transaction of monthExpenses) {
    const key = transaction.categoryId ?? null;
    const current = totalsByCategory.get(key) ?? { total: 0, count: 0 };
    totalsByCategory.set(key, {
      total: fromMinorUnits(toMinorUnits(current.total) + toMinorUnits(transaction.amount)),
      count: current.count + 1,
    });
  }

  const spendingByCategory: TwinCategorySpend[] = [...totalsByCategory.entries()]
    .map(([categoryId, value]) => ({
      categoryId,
      label: categoryName(categories, categoryId),
      total: value.total,
      shareOfExpenses: sharePercent(value.total, expenseTotal),
    }))
    .sort((a, b) => b.total - a.total);

  const transactionRefs = boundedTransactionRefs(monthExpenses);
  const notes: string[] = [`Behaviour window: ${monthKey} (${monthExpenses.length} expenses).`];
  if (transactionRefs.truncated) {
    notes.push(
      `Evidence lists the first ${MAX_TRANSACTION_SOURCE_REFS} expenses in date order (of ${monthExpenses.length}).`,
    );
  }

  const recurringMonthlyEquivalent = metrics.safeToSpend?.committedBills ?? null;
  const data: TwinBehaviourData = {
    periodKey: monthKey,
    expenseCount: monthExpenses.length,
    expenseTotal,
    spendingByCategory,
    recurringMonthlyEquivalent,
    recurringShareOfExpenses:
      recurringMonthlyEquivalent === null ? null : sharePercent(recurringMonthlyEquivalent, expenseTotal),
    savingsRate: metrics.monthly?.savingsRate ?? null,
    monthlySurplus: metrics.monthly ? subtractMoney(metrics.monthly.income, metrics.monthly.expenses) : null,
    transactionCount: transactions.length,
  };

  const evidence = twinEvidence({
    ruleId: 'twin.behaviour',
    periodKey: monthKey,
    computedAt,
    metrics: {
      expense_count: monthExpenses.length,
      expense_total: expenseTotal,
      categories_used: spendingByCategory.length,
      top_category_share: spendingByCategory[0]?.shareOfExpenses ?? 0,
      recurring_monthly: recurringMonthlyEquivalent ?? 0,
      savings_rate: data.savingsRate ?? 0,
      monthly_surplus: data.monthlySurplus ?? 0,
    },
    sourceRefs: [
      ...transactionRefs.refs,
      ...spendingByCategory
        .filter((entry) => entry.categoryId !== null)
        .map((entry) => sourceRef('categories', entry.categoryId as string)),
    ],
  });

  return available(data, evidence, notes);
}

/* --------------------------------------------------------------------------- */
/* C. Health — how the numbers score                                            */
/* --------------------------------------------------------------------------- */

export interface TwinHealthData {
  netWorth: NetWorthBreakdown | null;
  bufferMonths: number | null;
  safeToSpend: SafeToSpendBreakdown | null;
  financialHealthScore: number | null;
  savingsRate: number | null;
  goalProgress: GoalProgressInfo;
}

/**
 * "How healthy is this?" — engine health outputs verbatim. A null field stays
 * null and is explained in the notes; the UI must never read a null as zero.
 */
export function buildHealthSummary(input: TwinDerivationInput): IntelligenceSection<TwinHealthData> {
  const { now, accounts, transactions, budgets, goals, recurringTransactions, metrics } = input;
  const computedAt = now.toISOString();

  if (!metrics.hasData) {
    return insufficientTwin<TwinHealthData>([
      insufficient(
        'no_activity',
        'Add accounts, transactions, budgets or goals and your twin can start scoring your financial health.',
        ['accounts', 'transactions', 'budgets', 'goals'],
      ),
    ]);
  }

  const notes: string[] = [];
  if (metrics.netWorth === null) {
    notes.push('Add an account so net worth and the cash buffer can be derived.');
  }
  if (metrics.monthly === null) {
    notes.push('No transactions yet, so savings rate and Safe-to-Spend inputs are pending.');
  } else if (metrics.financialHealthScore === null) {
    notes.push('The health score needs this month\u2019s income, expenses and account balances together.');
  }
  if (metrics.bufferMonths === null) {
    notes.push('The buffer needs both an account balance and this month\u2019s expenses.');
  }

  const data: TwinHealthData = {
    netWorth: metrics.netWorth,
    bufferMonths: metrics.bufferMonths,
    safeToSpend: metrics.safeToSpend,
    financialHealthScore: metrics.financialHealthScore,
    savingsRate: metrics.monthly?.savingsRate ?? null,
    goalProgress: metrics.goalProgress,
  };

  const evidence = twinEvidence({
    ruleId: 'twin.health',
    periodKey: periodKeyOf(now),
    computedAt,
    metrics: {
      net_worth: metrics.netWorth?.netWorth ?? 0,
      cash: metrics.netWorth?.cash ?? 0,
      investments: metrics.netWorth?.investments ?? 0,
      debt: metrics.netWorth?.debt ?? 0,
      buffer_months: metrics.bufferMonths ?? 0,
      safe_to_spend: metrics.safeToSpend?.safeToSpend ?? 0,
      financial_health_score: metrics.financialHealthScore ?? 0,
      savings_rate: data.savingsRate ?? 0,
      goal_progress: metrics.goalProgress.aggregate ?? 0,
    },
    sourceRefs: [
      ...accounts.map((account) => sourceRef('accounts', account.id)),
      ...budgets.map((budget) => sourceRef('budgets', budget.id)),
      ...goals.map((goal) => sourceRef('goals', goal.id)),
      ...recurringTransactions.map((item) => sourceRef('recurring_transactions', item.id)),
      ...boundedTransactionRefs(transactions).refs,
    ],
  });

  return available(data, evidence, notes);
}

/* --------------------------------------------------------------------------- */
/* D. Relationships — how the pieces connect                                    */
/* --------------------------------------------------------------------------- */

export interface TwinAccountLink {
  accountId: string;
  label: string;
  transactionCount: number;
  inflow: number;
  outflow: number;
}

export interface TwinCategoryLink {
  categoryId: string | null;
  label: string;
  transactionCount: number;
  amount: number;
}

export interface TwinBudgetLink {
  budgetId: string;
  categoryId: string;
  label: string;
  limit: number;
  spent: number;
  /** spent/limit as 0–100 with one decimal; null when the limit is 0. */
  utilization: number | null;
}

export interface TwinGoalLink {
  goalId: string;
  title: string;
  /** 0–100 engine progress for this goal. */
  progress: number;
  contributionTotal: number;
}

export interface TwinRecurringLink {
  recurringId: string;
  label: string;
  monthlyEquivalent: number;
}

export interface TwinRelationshipsData {
  accountLinks: TwinAccountLink[];
  categoryLinks: TwinCategoryLink[];
  budgetLinks: TwinBudgetLink[];
  goalLinks: TwinGoalLink[];
  recurringLinks: TwinRecurringLink[];
}

/**
 * "How does everything connect?" — explicit links between persisted rows:
 * accounts↔transactions, categories↔expenses, budgets↔spending,
 * goals↔contributions and recurring↔monthly cash flow.
 */
export function buildRelationshipsSummary(input: TwinDerivationInput): IntelligenceSection<TwinRelationshipsData> {
  const { now, accounts, categories, transactions, budgets, goals, recurringTransactions } = input;
  const computedAt = now.toISOString();

  const activeAccounts = accounts.filter((account) => !account.isArchived);
  const activeGoals = goals.filter((goal) => goal.status === 'active');
  const activeRecurring = recurringTransactions.filter((item) => item.isActive);

  const accountLinks: TwinAccountLink[] = activeAccounts.map((account) => {
    const accountTransactions = transactions.filter(
      (transaction) => transaction.accountId === account.id || transaction.toAccountId === account.id,
    );
    return {
      accountId: account.id,
      label: account.name,
      transactionCount: accountTransactions.length,
      inflow: sumMoney(
        accountTransactions
          .filter((transaction) => transaction.type === 'income' && transaction.accountId === account.id)
          .map((transaction) => transaction.amount),
      ),
      outflow: sumMoney(
        accountTransactions
          .filter(
            (transaction) =>
              (transaction.type === 'expense' || transaction.type === 'transfer') &&
              transaction.accountId === account.id,
          )
          .map((transaction) => transaction.amount),
      ),
    };
  });

  const categoryTotals = new Map<string | null, { count: number; amount: number }>();
  for (const transaction of transactions) {
    if (transaction.type !== 'expense') continue;
    const key = transaction.categoryId ?? null;
    const current = categoryTotals.get(key) ?? { count: 0, amount: 0 };
    categoryTotals.set(key, {
      count: current.count + 1,
      amount: fromMinorUnits(toMinorUnits(current.amount) + toMinorUnits(transaction.amount)),
    });
  }
  const categoryLinks = [...categoryTotals.entries()]
    .map(([categoryId, value]) => ({
      categoryId,
      label: categoryName(categories, categoryId),
      transactionCount: value.count,
      amount: value.amount,
    }))
    .sort((a, b) => b.amount - a.amount);

  const budgetLinks: TwinBudgetLink[] = budgets.map((budget) => ({
    budgetId: budget.id,
    categoryId: budget.categoryId,
    label: categoryName(categories, budget.categoryId),
    limit: budget.limit,
    // `spent` is already the engine-derived value maintained in the store.
    spent: budget.spent,
    utilization: budget.limit > 0 ? sharePercent(budget.spent, budget.limit) : null,
  }));

  const goalLinks: TwinGoalLink[] = activeGoals.map((goal) => ({
    goalId: goal.id,
    title: goal.title,
    progress: goalProgress(goal),
    contributionTotal: goal.currentAmount,
  }));

  const recurringLinks: TwinRecurringLink[] = activeRecurring.map((item) => ({
    recurringId: item.id,
    label: recurringLabel(item),
    monthlyEquivalent: recurringMonthlyEquivalent(item),
  }));

  const data: TwinRelationshipsData = {
    accountLinks,
    categoryLinks,
    budgetLinks,
    goalLinks,
    recurringLinks,
  };

  const isTrulyEmpty =
    accountLinks.length === 0 &&
    categoryLinks.length === 0 &&
    budgetLinks.length === 0 &&
    goalLinks.length === 0 &&
    recurringLinks.length === 0;

  if (isTrulyEmpty) {
    return insufficientTwin<TwinRelationshipsData>([
      insufficient('no_accounts', 'No accounts are linked yet.', ['accounts']),
      insufficient('no_transactions', 'No transactions are recorded yet.', ['transactions']),
      insufficient('no_budgets', 'No budgets are planned yet.', ['budgets']),
      insufficient('no_goals', 'No goals are active yet.', ['goals']),
      insufficient('no_recurring_transactions', 'No recurring commitments are scheduled yet.', ['recurring_transactions']),
    ]);
  }

  const transactionRefs = boundedTransactionRefs(transactions);
  const notes: string[] = [];
  if (transactionRefs.truncated) {
    notes.push(
      `Evidence lists the first ${MAX_TRANSACTION_SOURCE_REFS} transactions in date order (of ${transactions.length}).`,
    );
  }

  const evidence = twinEvidence({
    ruleId: 'twin.relationships',
    periodKey: ALL_PERIOD_KEY,
    computedAt,
    metrics: {
      accounts_linked: accountLinks.length,
      categories_used: categoryLinks.length,
      budgets_linked: budgetLinks.length,
      goals_linked: goalLinks.length,
      recurring_linked: recurringLinks.length,
      transactions: transactions.length,
    },
    sourceRefs: [
      ...accountLinks.map((link) => sourceRef('accounts', link.accountId)),
      ...budgetLinks.map((link) => sourceRef('budgets', link.budgetId)),
      ...goalLinks.map((link) => sourceRef('goals', link.goalId)),
      ...recurringLinks.map((link) => sourceRef('recurring_transactions', link.recurringId)),
      ...categoryLinks
        .filter((link) => link.categoryId !== null)
        .map((link) => sourceRef('categories', link.categoryId as string)),
      ...transactionRefs.refs,
    ],
  });

  return available(data, evidence, notes);
}

/* --------------------------------------------------------------------------- */
/* Aggregate                                                                    */
/* --------------------------------------------------------------------------- */

export interface FinancialTwin {
  state: IntelligenceSection<TwinStateData>;
  behaviour: IntelligenceSection<TwinBehaviourData>;
  health: IntelligenceSection<TwinHealthData>;
  relationships: IntelligenceSection<TwinRelationshipsData>;
}

/**
 * Derive the whole twin in one pass (Phase 4A §5 step 3). The provider calls
 * this once per financial state change; no consumer re-derives any part.
 */
export function buildFinancialTwin(input: TwinDerivationInput): FinancialTwin {
  return {
    state: buildFinancialSnapshotSummary(input),
    behaviour: buildBehaviourSummary(input),
    health: buildHealthSummary(input),
    relationships: buildRelationshipsSummary(input),
  };
}

/* --------------------------------------------------------------------------- */
/* E. Persisted twin memory — guarded snapshot capture                          */
/* --------------------------------------------------------------------------- */

/** A complete snapshot draft — every field is engine output, ready to persist. */
export interface TwinSnapshotDraft {
  netWorth: number;
  cashFlow: number;
  safeToSpend: number;
  financialHealthScore: number;
  income: number;
  expenses: number;
  savingsRate: number;
  debt: number;
  currencyCode: CurrencyCode;
}

/**
 * Assemble a snapshot draft strictly from `computeDashboardMetrics()` output
 * (Phase 4A §6B). Returns null — never a partial guess — when any engine input
 * the snapshot table requires is not derivable (its columns are NOT NULL).
 */
export function buildSnapshotDraft(args: {
  metrics: DashboardMetrics;
  /** The profile's primary currency; a snapshot cannot be stored without it. */
  currencyCode: CurrencyCode | null;
}): TwinSnapshotDraft | null {
  const { metrics, currencyCode } = args;
  if (currencyCode === null) return null;
  const { netWorth, monthly, safeToSpend, financialHealthScore } = metrics;
  if (netWorth === null || monthly === null || safeToSpend === null || financialHealthScore === null) {
    return null;
  }
  return {
    netWorth: roundMoney(netWorth.netWorth),
    cashFlow: subtractMoney(monthly.income, monthly.expenses),
    safeToSpend: roundMoney(safeToSpend.safeToSpend),
    financialHealthScore,
    income: roundMoney(monthly.income),
    expenses: roundMoney(monthly.expenses),
    savingsRate: monthly.savingsRate,
    debt: roundMoney(netWorth.debt),
    currencyCode,
  };
}

/** Why the capture predicate fired (or did not). */
export type SnapshotCaptureReason = 'first_snapshot' | 'new_period' | 'material_change' | 'none';

/** Local day key of a stored capture timestamp (`captured_at`). */
export function snapshotDayKey(capturedAt: string): string {
  const parsed = new Date(capturedAt);
  return Number.isNaN(parsed.getTime()) ? '' : toISODate(parsed);
}

/** Relative band with an absolute fallback when the base is zero. */
function relativelyChanged(previous: number, next: number, band: number): boolean {
  const delta = Math.abs(subtractMoney(next, previous));
  if (delta === 0) return false;
  const base = Math.abs(previous);
  return base <= 0 ? true : delta / base >= band;
}

function materiallyChanged(previous: FinancialSnapshot, next: TwinSnapshotDraft): boolean {
  return (
    relativelyChanged(previous.netWorth, next.netWorth, SNAPSHOT_NET_WORTH_MATERIAL_BAND) ||
    relativelyChanged(previous.safeToSpend, next.safeToSpend, SNAPSHOT_SAFE_TO_SPEND_MATERIAL_BAND) ||
    Math.abs(next.financialHealthScore - previous.financialHealthScore) >= SNAPSHOT_HEALTH_SCORE_MATERIAL_BAND
  );
}

/**
 * Deterministic capture predicate (Phase 4A §6B): at most one snapshot per
 * local day, recaptured within the day only when a documented material-change
 * band fires on health score, Safe-to-Spend or net worth.
 */
export function snapshotCaptureReason(args: {
  todayKey: string;
  latestSnapshot: FinancialSnapshot | null;
  draft: TwinSnapshotDraft;
}): SnapshotCaptureReason {
  const { todayKey, latestSnapshot, draft } = args;
  if (latestSnapshot === null) return 'first_snapshot';
  if (snapshotDayKey(latestSnapshot.capturedAt) !== todayKey) return 'new_period';
  return materiallyChanged(latestSnapshot, draft) ? 'material_change' : 'none';
}
