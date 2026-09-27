/**
 * Phase 4C Advanced Financial Analytics — pure deterministic engine.
 *
 * Every function in this module:
 *   - is pure (no side effects, no I/O, no state)
 *   - takes only already-loaded application data as input
 *   - returns an IntelligenceSection<T> (available-with-evidence or insufficient_data)
 *   - never calls Supabase, repositories, persistence, or AI
 *   - is safe to call from any React component via useMemo
 *
 * Implementation order:
 *   4C-2: spendingTrend, incomeExpenseTrend, categoryTrend, savingsTrend
 *   4C-3: budgetUtilization, recurringImpact, financialStateChanges
 *
 * Hidden-spending detectors live in hiddenSpendingDetector.ts (4C-4).
 */

import type {
  TrendPoint,
  CategoryTrendPoint,
  BudgetUtilization,
  RecurringImpact,
  SnapshotTrendPoint,
} from '../../types/analytics';
import type { IntelligenceSection, SourceRef } from '../../types/intelligence';
import {
  insufficient,
  buildEvidence,
  sourceRef,
  dedupeSourceRefs,
  sharePercent,
  ALL_PERIOD_KEY,
} from '../../intelligence/evidence';
import { available, unavailable } from '../../intelligence/section';
import type {
  Account, Budget, Category, Goal, RecurrenceFrequency, RecurringTransaction,
  Transaction, UserProfile,
} from '../../types/financial';
import type { DashboardMetrics } from '../../types/financial';
import type { FinancialSnapshot } from '../../types/financial';
import { parseISODate } from '../../lib/date';

/** The data an analytics function needs from the already-loaded store. */
export interface AnalyticsData {
  transactions: Transaction[];
  categories: Category[];
  budgets: Budget[];
  goals: Goal[];
  recurringTransactions: RecurringTransaction[];
  accounts: Account[];
  profile: UserProfile | null;
  snapshots: FinancialSnapshot[];
  metrics: DashboardMetrics;
}

/* ------------------------------------------------------------------ *
 * Internal helpers
 * ------------------------------------------------------------------ */

/** Filter to expense transactions only, one pass, deterministic order. */
function expenseTransactions(transactions: readonly Transaction[]): Transaction[] {
  return transactions.filter((t) => t.type === 'expense');
}

/** Filter to income transactions only, one pass, deterministic order. */
function incomeTransactions(transactions: readonly Transaction[]): Transaction[] {
  return transactions.filter((t) => t.type === 'income');
}

/**
 * Bucket transactions into `YYYY-MM` periods (same key shape as `periodKeyOf`).
 * Invalid date rows are skipped, never silently summed.
 */
function bucketByMonth(
  transactions: readonly Transaction[],
): Map<string, Transaction[]> {
  const buckets = new Map<string, Transaction[]>();
  for (const t of transactions) {
    const parts = parseISODate(t.date);
    if (!parts) continue;
    const key = `${parts.year}-${String(parts.month).padStart(2, '0')}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(t);
    else buckets.set(key, [t]);
  }
  return buckets;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Human-readable period label from a `YYYY-MM` key. */
function periodLabel(key: string): string {
  const idx = Number(key.slice(5, 7)) - 1;
  return idx >= 0 && idx < 12 ? `${MONTH_NAMES[idx]} ${key.slice(0, 4)}` : key;
}

/** Build an AnalyticsPeriod from a `YYYY-MM` key and its transactions. */
function periodOf(key: string, txs: readonly Transaction[]) {
  let start: string | null = null;
  let end: string | null = null;
  for (const t of txs) {
    if (start === null || t.date < start) start = t.date;
    if (end === null || t.date > end) end = t.date;
  }
  return { key, label: periodLabel(key), start: start ?? key, end: end ?? key };
}

/** Sum of amounts for one group, keeping every row's source pointer. */
function sumWithRefs(txs: readonly Transaction[]): { total: number; refs: SourceRef[] } {
  let total = 0;
  const refs: SourceRef[] = [];
  for (const t of txs) {
    total += t.amount;
    refs.push(sourceRef('transactions', t.id));
  }
  return { total, refs };
}

/** Sort period keys chronologically (lexicographic on `YYYY-MM` is correct). */
function sortedKeys(buckets: Map<string, Transaction[]>): string[] {
  return [...buckets.keys()].sort((a, b) => a.localeCompare(b));
}

/** Round to 2 decimals (currency display precision). */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Map already-chronological snapshots to trend points with per-row refs. */
function toSnapshotPoints(snapshots: readonly FinancialSnapshot[]): SnapshotTrendPoint[] {
  return snapshots.map((s) => ({
    capturedAt: s.capturedAt,
    dateLabel: s.capturedAt.slice(0, 10),
    netWorth: s.netWorth,
    healthScore: s.financialHealthScore,
    safeToSpend: s.safeToSpend,
    savingsRatePercent: s.savingsRate,
    sourceRefs: dedupeSourceRefs([sourceRef('snapshots', s.id)]),
  }));
}

/** Average weeks per month, used to normalize weekly recurring amounts. */
const WEEKS_PER_MONTH = 52 / 12;

/** Deterministic monthly-equivalent of a recurring amount by frequency. */
function monthlyEquivalentOf(amount: number, frequency: RecurrenceFrequency): number {
  if (frequency === 'weekly') return round2(amount * WEEKS_PER_MONTH);
  if (frequency === 'yearly') return round2(amount / 12);
  return amount;
}

const ANALYTICS_RULE_VERSION = '4c.3';

/**
 * Spending trend over available periods (expense transactions only).
 * Buckets expenses by month; each point carries the exact source refs of the
 * transactions that produced it. No zero-filling of missing months.
 */
export function spendingTrend(
  data: AnalyticsData,
  computedAt: string,
): IntelligenceSection<TrendPoint[]> {
  const expenses = expenseTransactions(data.transactions);
  if (expenses.length === 0) {
    return unavailable([
      insufficient('no_expenses', 'No expense transactions recorded yet, so a spending trend cannot be derived.', ['transactions']),
    ]);
  }

  const buckets = bucketByMonth(expenses);
  const points: TrendPoint[] = sortedKeys(buckets).map((key) => {
    const txs = buckets.get(key)!;
    const { total, refs } = sumWithRefs(txs);
    return {
      period: periodOf(key, txs),
      value: Math.round(total * 100) / 100,
      sourceRefs: dedupeSourceRefs(refs),
    };
  });

  const evidence = buildEvidence({
    ruleId: 'analytics.spendingTrend',
    periodKey: ALL_PERIOD_KEY,
    computedAt,
    metrics: {
      expenseCount: expenses.length,
      periodCount: points.length,
      totalExpense: Math.round(points.reduce((s, p) => s + p.value, 0) * 100) / 100,
    },
    sourceRefs: points.flatMap((p) => p.sourceRefs),
    ruleVersion: ANALYTICS_RULE_VERSION,
  });

  return available(points, evidence);
}

/**
 * Income vs expense trend per period, with net flow = income - expenses.
 * Returns insufficient_data naming which side is missing when either income
 * or expense data is absent.
 */
export function incomeExpenseTrend(
  data: AnalyticsData,
  computedAt: string,
): IntelligenceSection<{ income: TrendPoint[]; expenses: TrendPoint[] }> {
  const income = incomeTransactions(data.transactions);
  const expenses = expenseTransactions(data.transactions);

  if (income.length === 0 && expenses.length === 0) {
    return unavailable([
      insufficient('no_activity', 'No income or expense transactions recorded yet, so cash-flow trends cannot be derived.', ['transactions']),
    ]);
  }
  if (income.length === 0) {
    return unavailable([
      insufficient('no_income', 'No income transactions recorded yet — expense data exists but a net cash-flow trend needs both sides.', ['transactions']),
    ]);
  }
  if (expenses.length === 0) {
    return unavailable([
      insufficient('no_expenses', 'No expense transactions recorded yet — income data exists but a net cash-flow trend needs both sides.', ['transactions']),
    ]);
  }

  const buildPoints = (txs: readonly Transaction[]): TrendPoint[] => {
    const buckets = bucketByMonth(txs);
    return sortedKeys(buckets).map((key) => {
      const group = buckets.get(key)!;
      const { total, refs } = sumWithRefs(group);
      return {
        period: periodOf(key, group),
        value: Math.round(total * 100) / 100,
        sourceRefs: dedupeSourceRefs(refs),
      };
    });
  };

  const incomePoints = buildPoints(income);
  const expensePoints = buildPoints(expenses);

  const totalIncome = Math.round(incomePoints.reduce((s, p) => s + p.value, 0) * 100) / 100;
  const totalExpenses = Math.round(expensePoints.reduce((s, p) => s + p.value, 0) * 100) / 100;
  const netFlow = Math.round((totalIncome - totalExpenses) * 100) / 100;

  const evidence = buildEvidence({
    ruleId: 'analytics.incomeExpenseTrend',
    periodKey: ALL_PERIOD_KEY,
    computedAt,
    metrics: {
      incomeCount: income.length,
      expenseCount: expenses.length,
      totalIncome,
      totalExpenses,
      netFlow,
    },
    sourceRefs: [...incomePoints, ...expensePoints].flatMap((p) => p.sourceRefs),
    ruleVersion: ANALYTICS_RULE_VERSION,
  });

  return available(
    { income: incomePoints, expenses: expensePoints },
    evidence,
    [`Net flow over the covered history is ${netFlow >= 0 ? 'positive' : 'negative'} (income ${totalIncome} − expenses ${totalExpenses}).`],
  );
}

/**
 * Category spend breakdown over all expense history, with sharePercent.
 * Uncategorized expenses get their own bucket (`categoryId: 'uncategorized'`,
 * `categoryName: null`) so they never silently disappear from the totals.
 */
export function categoryTrend(
  data: AnalyticsData,
  computedAt: string,
): IntelligenceSection<CategoryTrendPoint[]> {
  const expenses = expenseTransactions(data.transactions);
  if (expenses.length === 0) {
    return unavailable([
      insufficient('no_expenses', 'No expense transactions recorded yet, so category spending cannot be derived.', ['transactions']),
    ]);
  }

  const categoryById = new Map(data.categories.map((c) => [c.id, c]));
  const groups = new Map<string | null, Transaction[]>();
  for (const t of expenses) {
    const key = t.categoryId ?? null;
    const group = groups.get(key);
    if (group) group.push(t);
    else groups.set(key, [t]);
  }

  const { total: grandTotal, refs: allRefs } = sumWithRefs(expenses);
  const points: CategoryTrendPoint[] = [...groups.entries()]
    .map(([categoryId, txs]) => {
      const { total, refs } = sumWithRefs(txs);
      const category = categoryId !== null ? categoryById.get(categoryId) : undefined;
      return {
        categoryId: categoryId ?? 'uncategorized',
        categoryName: category ? category.name : null,
        value: Math.round(total * 100) / 100,
        sharePercent: sharePercent(total, grandTotal),
        sourceRefs: dedupeSourceRefs(refs),
      };
    })
    .sort((a, b) => b.value - a.value || a.categoryId.localeCompare(b.categoryId));

  const evidence = buildEvidence({
    ruleId: 'analytics.categoryTrend',
    periodKey: ALL_PERIOD_KEY,
    computedAt,
    metrics: {
      expenseCount: expenses.length,
      categoryCount: points.length,
      totalExpense: Math.round(grandTotal * 100) / 100,
    },
    sourceRefs: dedupeSourceRefs(allRefs),
    ruleVersion: ANALYTICS_RULE_VERSION,
  });

  const uncategorized = groups.get(null);
  const notes = uncategorized
    ? [`${uncategorized.length} expense transaction(s) have no category and are grouped under "uncategorized".`]
    : [];

  return available(points, evidence, notes);
}

/**
 * Savings trend.
 *
 * Two deterministic sources:
 *  1. Snapshot history (primary): when >= MIN_SNAPSHOTS_FOR_TREND snapshots
 *     exist, report each captured snapshot's savingsRate — the twin is never
 *     re-derived.
 *  2. Transaction fallback: monthly savings rate = (income - expenses)/income*100
 *     for months with both income and expenses and positive income.
 * Never invents history; months lacking both sides are omitted.
 */
export function savingsTrend(
  data: AnalyticsData,
  computedAt: string,
): IntelligenceSection<SnapshotTrendPoint[]> {
  const MIN_SNAPSHOTS_FOR_TREND = 2;
  const snapshots = [...data.snapshots].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));

  if (snapshots.length >= MIN_SNAPSHOTS_FOR_TREND) {
    const points: SnapshotTrendPoint[] = toSnapshotPoints(snapshots);

    const latest = snapshots[snapshots.length - 1];
    const evidence = buildEvidence({
      ruleId: 'analytics.savingsTrend.snapshots',
      periodKey: ALL_PERIOD_KEY,
      computedAt,
      metrics: {
        snapshotCount: snapshots.length,
        latestNetWorth: latest.netWorth,
        latestSavingsRate: latest.savingsRate,
      },
      sourceRefs: points.flatMap((p) => p.sourceRefs),
      ruleVersion: ANALYTICS_RULE_VERSION,
    });

    return available(points, evidence);
  }

  // Snapshot fallback: derive monthly savings rate from transactions.
  const income = incomeTransactions(data.transactions);
  const expenses = expenseTransactions(data.transactions);
  if (income.length === 0 || expenses.length === 0) {
    return unavailable([
      insufficient(
        'no_activity',
        `A savings trend needs at least ${MIN_SNAPSHOTS_FOR_TREND} Digital Twin snapshots, or both income and expense transactions. Found ${snapshots.length} snapshot(s).`,
        ['snapshots', 'transactions'],
      ),
    ]);
  }

  const incomeBuckets = bucketByMonth(income);
  const expenseBuckets = bucketByMonth(expenses);
  const points: SnapshotTrendPoint[] = [];
  for (const key of sortedKeys(incomeBuckets)) {
    const incomeTxs = incomeBuckets.get(key)!;
    const expenseTxs = expenseBuckets.get(key);
    if (!expenseTxs) continue; // rate undefined without both sides
    const { total: monthIncome, refs: incomeRefs } = sumWithRefs(incomeTxs);
    const { total: monthExpenses, refs: expenseRefs } = sumWithRefs(expenseTxs);
    if (monthIncome <= 0) continue; // savings rate undefined at zero income
    const rate = Math.round(((monthIncome - monthExpenses) / monthIncome) * 1000) / 10;
    points.push({
      capturedAt: key,
      dateLabel: periodLabel(key),
      netWorth: null,
      healthScore: null,
      safeToSpend: null,
      savingsRatePercent: rate,
      sourceRefs: dedupeSourceRefs([...incomeRefs, ...expenseRefs]),
    });
  }

  if (points.length === 0) {
    return unavailable([
      insufficient('no_activity', 'No month has both income and expenses with positive income from which a savings rate can be derived.', ['transactions']),
    ]);
  }

  const evidence = buildEvidence({
    ruleId: 'analytics.savingsTrend.transactions',
    periodKey: ALL_PERIOD_KEY,
    computedAt,
    metrics: { monthCount: points.length },
    sourceRefs: points.flatMap((p) => p.sourceRefs),
    ruleVersion: ANALYTICS_RULE_VERSION,
  });

  return available(
    points,
    evidence,
    ['Derived from monthly transactions — capture Digital Twin snapshots over time to unlock net-worth progression.'],
  );
}

/**
 * Budget utilization per budget (Phase 4C-3).
 *
 * `spent` is re-derived with the Phase 2/3 rule: exact sum of real expense
 * transactions in the budget category inside [startDate, endDate]. The
 * stored `budget.spent` is ignored as input so analytics stay reproducible
 * from the supplied transactions. Zero spending is valid; zero/negative
 * limits yield `utilizationPercent: null`. Over-budget reports > 100.
 */
export function budgetUtilization(
  data: AnalyticsData,
  computedAt: string,
): IntelligenceSection<BudgetUtilization[]> {
  if (data.budgets.length === 0) {
    return unavailable([
      insufficient('no_budgets', 'No budgets are set up yet, so budget utilization cannot be derived.', ['budgets']),
    ]);
  }

  // One pass: group expense transactions by category for O(n) lookup.
  const expensesByCategory = new Map<string, Transaction[]>();
  for (const t of data.transactions) {
    if (t.type !== 'expense') continue;
    if (t.categoryId === undefined) continue;
    const group = expensesByCategory.get(t.categoryId);
    if (group) group.push(t);
    else expensesByCategory.set(t.categoryId, [t]);
  }

  const items: BudgetUtilization[] = data.budgets.map((budget) => {
    const candidates = expensesByCategory.get(budget.categoryId) ?? [];
    let spent = 0;
    const refs: SourceRef[] = [sourceRef('budgets', budget.id)];
    for (const t of candidates) {
      if (t.date < budget.startDate || t.date > budget.endDate) continue;
      spent += t.amount;
      refs.push(sourceRef('transactions', t.id));
    }
    spent = round2(spent);
    return {
      budgetId: budget.id,
      categoryId: budget.categoryId,
      limit: budget.limit,
      spent,
      utilizationPercent: budget.limit > 0 ? sharePercent(spent, budget.limit) : null,
      sourceRefs: dedupeSourceRefs(refs),
    };
  });

  const evidence = buildEvidence({
    ruleId: 'analytics.budgetUtilization',
    periodKey: ALL_PERIOD_KEY,
    computedAt,
    metrics: {
      budgetCount: items.length,
      overBudgetCount: items.filter((i) => i.utilizationPercent !== null && i.utilizationPercent > 100).length,
    },
    sourceRefs: items.flatMap((item) => item.sourceRefs),
    ruleVersion: ANALYTICS_RULE_VERSION,
  });

  return available(items, evidence);
}

/**
 * Recurring financial impact (Phase 4C-3).
 *
 * Monthly equivalent per active recurring definition (weekly x 52/12,
 * yearly / 12, monthly as-is, 2dp). Inactive schedules are excluded.
 * Linked actuals via `recurringTransactionId` are cited only when present.
 */
export function recurringImpact(
  data: AnalyticsData,
  computedAt: string,
): IntelligenceSection<RecurringImpact[]> {
  const active = data.recurringTransactions.filter((item) => item.isActive);
  if (active.length === 0) {
    return unavailable([
      insufficient(
        'no_recurring_transactions',
        'No active recurring transactions are tracked yet, so recurring impact cannot be derived.',
        ['recurring_transactions'],
      ),
    ]);
  }

  const actualsByRecurring = new Map<string, Transaction[]>();
  for (const t of data.transactions) {
    if (t.recurringTransactionId === undefined || t.recurringTransactionId === null) continue;
    const group = actualsByRecurring.get(t.recurringTransactionId);
    if (group) group.push(t);
    else actualsByRecurring.set(t.recurringTransactionId, [t]);
  }

  const items: RecurringImpact[] = active.map((item) => {
    const label = item.merchant?.trim() || item.description?.trim() || `Recurring ${item.type}`;
    const refs: SourceRef[] = [sourceRef('recurring_transactions', item.id)];
    for (const t of actualsByRecurring.get(item.id) ?? []) refs.push(sourceRef('transactions', t.id));
    return {
      recurringId: item.id,
      label,
      monthlyEquivalent: monthlyEquivalentOf(item.amount, item.frequency),
      sourceRefs: dedupeSourceRefs(refs),
    };
  });

  items.sort((a, b) => b.monthlyEquivalent - a.monthlyEquivalent || a.recurringId.localeCompare(b.recurringId));

  const evidence = buildEvidence({
    ruleId: 'analytics.recurringImpact',
    periodKey: ALL_PERIOD_KEY,
    computedAt,
    metrics: {
      recurringCount: items.length,
      totalMonthlyCommitment: round2(items.reduce((sum, item) => sum + item.monthlyEquivalent, 0)),
    },
    sourceRefs: items.flatMap((item) => item.sourceRefs),
    ruleVersion: ANALYTICS_RULE_VERSION,
  });

  return available(items, evidence);
}

/**
 * Financial-state changes from snapshot history (Phase 4C-3).
 *
 * Purely historical: preserves each snapshot's capturedAt, netWorth,
 * financialHealthScore, and safeToSpend in chronological order with
 * per-snapshot source refs. Requires >= 2 snapshots; never invents or
 * forecasts.
 */
export function financialStateChanges(
  data: AnalyticsData,
  computedAt: string,
): IntelligenceSection<SnapshotTrendPoint[]> {
  if (data.snapshots.length < 2) {
    return unavailable([
      insufficient(
        'no_activity',
        `Financial-state history needs at least 2 Digital Twin snapshots. Found ${data.snapshots.length} snapshot(s).`,
        ['snapshots'],
      ),
    ]);
  }

  const snapshots = [...data.snapshots].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const points: SnapshotTrendPoint[] = toSnapshotPoints(snapshots);
  const latest = snapshots[snapshots.length - 1];

  const evidence = buildEvidence({
    ruleId: 'analytics.financialStateChanges',
    periodKey: ALL_PERIOD_KEY,
    computedAt,
    metrics: {
      snapshotCount: snapshots.length,
      latestNetWorth: latest.netWorth,
      latestHealthScore: latest.financialHealthScore,
      latestSafeToSpend: latest.safeToSpend,
    },
    sourceRefs: points.flatMap((p) => p.sourceRefs),
    ruleVersion: ANALYTICS_RULE_VERSION,
  });

  return available(points, evidence);
}
