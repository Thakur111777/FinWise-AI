/**
 * Phase 4C Hidden Spending Detection — pure deterministic detectors.
 *
 * Every detector in this module:
 *   - is pure (no side effects, no I/O, no state)
 *   - takes only already-loaded application data as input
 *   - returns an IntelligenceSection<T> (available-with-evidence or insufficient_data)
 *   - never calls Supabase, repositories, persistence, or AI
 *   - flags only mechanically-detectable patterns with explicit evidence
 *   - never makes speculative conclusions or advice
 *
 * Detectors (4C-4, all implemented):
 *   1. detectSmallCharges
 *   2. detectSubscriptionPatterns
 *   3. detectUncategorizedSpending
 *   4. detectCategoryConcentration
 *   5. detectFeePatterns
 *   6. detectCashGaps
 *
 * "No pattern found" (available, empty) is distinct from insufficient_data
 * (the detector cannot reliably run).
 */

import type {
  SmallChargePattern,
  SubscriptionPattern,
  UncategorizedSpending,
  CategoryConcentration,
  FeePattern,
  CashGapSummary,
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
  Account,
  Category,
  RecurringTransaction,
  Transaction,
} from '../../types/financial';

/** The data a hidden spending detector needs from the already-loaded store. */
export interface DetectorData {
  transactions: Transaction[];
  categories: Category[];
  recurringTransactions: RecurringTransaction[];
  accounts: Account[];
}

/* ------------------------------------------------------------------ *
 * Shared deterministic helpers (4C-4)
 * ------------------------------------------------------------------ */

/** Rule version stamped on every 4C-4 evidence record. */
const DETECTOR_RULE_VERSION = '4c.4';

/** Round to 2 decimals (currency display precision). */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Safest explicit transaction label: merchant, description, then id. */
function explicitLabel(t: Transaction): string {
  return t.merchant?.trim() || t.description?.trim() || `Transaction ${t.id}`;
}

/** Canonical grouping key for merchant-like labels (case/space-insensitive). */
function merchantKey(label: string): string {
  return label.trim().toLowerCase();
}

/** Whole-day difference between two valid YYYY-MM-DD dates, or null. */
function dayDiff(from: string, to: string): number | null {
  const a = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  const b = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

/** Expense transactions only, preserving input order. */
function expenseOnly(transactions: readonly Transaction[]): Transaction[] {
  return transactions.filter((t) => t.type === 'expense');
}

/** Sum of amounts with per-row transaction source refs. */
function sumTxWithRefs(txs: readonly Transaction[]): { total: number; refs: SourceRef[] } {
  let total = 0;
  const refs: SourceRef[] = [];
  for (const t of txs) {
    total += t.amount;
    refs.push(sourceRef('transactions', t.id));
  }
  return { total, refs };
}

/**
 * Detect small, possibly-overlooked recurring charges.
 *
 * Groups small expense transactions by explicit merchant label; a pattern
 * needs >= MIN_OCCURRENCES charges each <= SMALL_CHARGE_MAX. A merchant's
 * dominant category is reported where one exists. No pattern found is
 * available-with-empty, not insufficient data.
 */
export function detectSmallCharges(
  data: DetectorData,
  computedAt: string,
): IntelligenceSection<SmallChargePattern[]> {
  const SMALL_CHARGE_MAX = 500;
  const MIN_OCCURRENCES = 3;

  const expenses = expenseOnly(data.transactions);
  if (expenses.length === 0) {
    return unavailable([
      insufficient(
        'no_activity',
        'Small-charge detection needs expense transactions. No expense transactions are recorded yet.',
        ['transactions'],
      ),
    ]);
  }

  const groups = new Map<string, { label: string; txs: Transaction[] }>();
  for (const t of expenses) {
    if (!(t.amount > 0) || t.amount > SMALL_CHARGE_MAX) continue;
    const label = explicitLabel(t);
    const key = merchantKey(label);
    const group = groups.get(key);
    if (group) group.txs.push(t);
    else groups.set(key, { label, txs: [t] });
  }

  const patterns: SmallChargePattern[] = [];
  for (const { label, txs } of groups.values()) {
    if (txs.length < MIN_OCCURRENCES) continue;
    const { total, refs } = sumTxWithRefs(txs);
    const rounded = round2(total);
    // Dominant category by summed amount; null when none is usable.
    const byCategory = new Map<string, number>();
    for (const t of txs) {
      if (t.categoryId === undefined) continue;
      byCategory.set(t.categoryId, (byCategory.get(t.categoryId) ?? 0) + t.amount);
    }
    let categoryId: string | null = null;
    let best = 0;
    for (const [id, sum] of byCategory) {
      if (sum > best) {
        best = sum;
        categoryId = id;
      }
    }
    patterns.push({
      merchantLabel: label,
      categoryId,
      transactionCount: txs.length,
      totalAmount: rounded,
      averageAmount: round2(rounded / txs.length),
      sourceRefs: dedupeSourceRefs(refs),
    });
  }

  patterns.sort((a, b) => b.transactionCount - a.transactionCount || a.merchantLabel.localeCompare(b.merchantLabel));

  const evidence = buildEvidence({
    ruleId: 'analytics.detectSmallCharges',
    periodKey: ALL_PERIOD_KEY,
    computedAt,
    metrics: { expenseCount: expenses.length, patternCount: patterns.length },
    sourceRefs: patterns.flatMap((p) => p.sourceRefs),
    ruleVersion: DETECTOR_RULE_VERSION,
  });

  return available(
    patterns,
    evidence,
    patterns.length === 0 ? ['No repeated small-charge clusters were observed.'] : [],
  );
}

/**
 * Detect subscription-like periodic charge patterns.
 *
 * Groups expense transactions by explicit merchant label and checks whether
 * sorted occurrence dates form an approximately regular weekly, monthly, or
 * yearly cadence (>= MIN_OCCURRENCES). Ranges are tolerance bands, never AI
 * guesses. Transactions already linked to a known recurring definition are
 * excluded. Wording is "subscription-like" — never certain.
 */
export function detectSubscriptionPatterns(
  data: DetectorData,
  computedAt: string,
): IntelligenceSection<SubscriptionPattern[]> {
  const MIN_OCCURRENCES = 3;

  const knownLinked = new Set<string>();
  for (const t of data.transactions) {
    if (t.recurringTransactionId !== undefined && t.recurringTransactionId !== null) {
      knownLinked.add(t.id);
    }
  }
  const candidates = expenseOnly(data.transactions).filter((t) => !knownLinked.has(t.id));
  if (candidates.length < MIN_OCCURRENCES) {
    return unavailable([
      insufficient(
        'no_activity',
        'Subscription-like detection needs at least 3 expense transactions not already linked to a known recurring schedule.',
        ['transactions', 'recurring_transactions'],
      ),
    ]);
  }

  const groups = new Map<string, { label: string; txs: Transaction[] }>();
  for (const t of candidates) {
    const label = explicitLabel(t);
    const key = merchantKey(label);
    const group = groups.get(key);
    if (group) group.txs.push(t);
    else groups.set(key, { label, txs: [t] });
  }

  const knownRecurringRefs: SourceRef[] = data.recurringTransactions
    .filter((r) => r.isActive)
    .map((r) => sourceRef('recurring_transactions', r.id));

  const patterns: SubscriptionPattern[] = [];
  for (const { label, txs } of groups.values()) {
    if (txs.length < MIN_OCCURRENCES) continue;
    const dates = txs.map((t) => t.date).sort((a, b) => a.localeCompare(b));
    const gaps: number[] = [];
    let valid = true;
    for (let i = 1; i < dates.length; i++) {
      const gap = dayDiff(dates[i - 1], dates[i]);
      if (gap === null || gap <= 0) {
        valid = false;
        break;
      }
      gaps.push(gap);
    }
    if (!valid) continue;
    const min = Math.min(...gaps);
    const max = Math.max(...gaps);
    let estimatedInterval: string | null = null;
    if (min >= 5 && max <= 9) estimatedInterval = 'weekly';
    else if (min >= 25 && max <= 35) estimatedInterval = 'monthly';
    else if (min >= 330 && max <= 400) estimatedInterval = 'yearly';
    if (estimatedInterval === null) continue;
    const { total, refs } = sumTxWithRefs(txs);
    patterns.push({
      merchantLabel: label,
      estimatedInterval,
      transactionCount: txs.length,
      totalAmount: round2(total),
      sourceRefs: dedupeSourceRefs(refs),
    });
  }

  patterns.sort((a, b) => a.merchantLabel.localeCompare(b.merchantLabel));

  const evidence = buildEvidence({
    ruleId: 'analytics.detectSubscriptionPatterns',
    periodKey: ALL_PERIOD_KEY,
    computedAt,
    metrics: { candidateCount: candidates.length, patternCount: patterns.length },
    sourceRefs: [...patterns.flatMap((p) => p.sourceRefs), ...knownRecurringRefs],
    ruleVersion: DETECTOR_RULE_VERSION,
  });

  return available(
    patterns,
    evidence,
    ['Subscription-like patterns detected from observed intervals; already-known recurring schedules were excluded.'],
  );
}

/**
 * Detect spending with no category assignment.
 *
 * No transactions at all → insufficient_data. Otherwise the detector runs
 * and reports the uncategorized expense slice; zero uncategorized is
 * available-with-zero (not insufficient data).
 */
export function detectUncategorizedSpending(
  data: DetectorData,
  computedAt: string,
): IntelligenceSection<UncategorizedSpending> {
  if (data.transactions.length === 0) {
    return unavailable([
      insufficient(
        'no_transactions',
        'Uncategorized-spending detection needs transactions. No transactions are recorded yet.',
        ['transactions'],
      ),
    ]);
  }

  const validIds = new Set(data.categories.map((c) => c.id));
  const uncategorized = expenseOnly(data.transactions).filter(
    (t) => t.categoryId === undefined || t.categoryId === null || !validIds.has(t.categoryId),
  );
  const { total, refs } = sumTxWithRefs(uncategorized);

  const evidence = buildEvidence({
    ruleId: 'analytics.detectUncategorizedSpending',
    periodKey: ALL_PERIOD_KEY,
    computedAt,
    metrics: {
      expenseCount: expenseOnly(data.transactions).length,
      uncategorizedCount: uncategorized.length,
      uncategorizedTotal: round2(total),
    },
    sourceRefs: refs,
    ruleVersion: DETECTOR_RULE_VERSION,
  });

  return available(
    { transactionCount: uncategorized.length, totalAmount: round2(total), sourceRefs: dedupeSourceRefs(refs) },
    evidence,
    uncategorized.length === 0 ? ['No uncategorized spending found.'] : [],
  );
}

/**
 * Detect categories consuming disproportionate share of spending.
 *
 * Uses the shared sharePercent helper; flags expense categories at or above
 * CONCENTRATION_THRESHOLD with at least MIN_EXPENSES of history. Sparse data
 * → insufficient_data; sufficient data with no crosser → available-empty.
 */
export function detectCategoryConcentration(
  data: DetectorData,
  computedAt: string,
): IntelligenceSection<CategoryConcentration[]> {
  const CONCENTRATION_THRESHOLD = 40;
  const MIN_EXPENSES = 3;

  const expenses = expenseOnly(data.transactions);
  if (expenses.length < MIN_EXPENSES) {
    return unavailable([
      insufficient(
        'no_activity',
        'Category-concentration detection needs at least 3 expense transactions.',
        ['transactions'],
      ),
    ]);
  }

  const nameById = new Map(data.categories.map((c) => [c.id, c.name]));
  const groups = new Map<string, Transaction[]>();
  for (const t of expenses) {
    // Null/unknown categories are the uncategorized detector's job, not this one.
    if (t.categoryId === undefined || t.categoryId === null || !nameById.has(t.categoryId)) continue;
    const group = groups.get(t.categoryId);
    if (group) group.push(t);
    else groups.set(t.categoryId, [t]);
  }

  const { total: grandTotal } = sumTxWithRefs(expenses);
  const flagged: CategoryConcentration[] = [];
  for (const [categoryId, txs] of groups) {
    const { total, refs } = sumTxWithRefs(txs);
    const share = sharePercent(total, grandTotal);
    if (share < CONCENTRATION_THRESHOLD) continue;
    flagged.push({
      categoryId,
      categoryName: nameById.get(categoryId) ?? null,
      sharePercent: share,
      totalSpent: round2(total),
      sourceRefs: dedupeSourceRefs(refs),
    });
  }

  flagged.sort((a, b) => b.sharePercent - a.sharePercent || a.categoryId.localeCompare(b.categoryId));

  const evidence = buildEvidence({
    ruleId: 'analytics.detectCategoryConcentration',
    periodKey: ALL_PERIOD_KEY,
    computedAt,
    metrics: { expenseCount: expenses.length, flaggedCount: flagged.length },
    sourceRefs: flagged.flatMap((f) => f.sourceRefs),
    ruleVersion: DETECTOR_RULE_VERSION,
  });

  return available(
    flagged,
    evidence,
    flagged.length === 0 ? ['No category reaches the concentration threshold.'] : [],
  );
}

/**
 * Detect fee, charge, and interest patterns.
 *
 * Only explicit signals count: an expense category whose name contains
 * fee/charge/interest/penalty, or a merchant/description/notes label that
 * explicitly says so. No fuzzy guessing — anything else is ignored. Runs
 * whenever expense history exists, so "no fees" is available-empty.
 */
export function detectFeePatterns(
  data: DetectorData,
  computedAt: string,
): IntelligenceSection<FeePattern[]> {
  const FEE_TOKENS = ['fee', 'charge', 'interest', 'penalty'];

  const expenses = expenseOnly(data.transactions);
  if (expenses.length === 0) {
    return unavailable([
      insufficient(
        'no_activity',
        'Fee detection needs expense transactions. No expense transactions are recorded yet.',
        ['transactions'],
      ),
    ]);
  }

  const feeCategoryIds = new Set<string>();
  for (const c of data.categories) {
    if (c.type !== 'expense') continue;
    const name = c.name.toLowerCase();
    if (FEE_TOKENS.some((token) => name.includes(token))) feeCategoryIds.add(c.id);
  }

  const isExplicitFeeText = (t: Transaction): boolean => {
    const haystack = `${t.merchant ?? ''} ${t.description ?? ''} ${t.notes ?? ''}`.toLowerCase();
    return FEE_TOKENS.some((token) => haystack.includes(token));
  };

  const fees = expenses.filter(
    (t) =>
      (t.categoryId !== undefined && t.categoryId !== null && feeCategoryIds.has(t.categoryId)) ||
      isExplicitFeeText(t),
  );

  const groups = new Map<string, { label: string; categoryId: string | null; txs: Transaction[] }>();
  for (const t of fees) {
    const label = explicitLabel(t);
    const key = merchantKey(label);
    const group = groups.get(key);
    if (group) group.txs.push(t);
    else groups.set(key, { label, categoryId: t.categoryId ?? null, txs: [t] });
  }

  const patterns: FeePattern[] = [];
  for (const { label, categoryId, txs } of groups.values()) {
    const { total, refs } = sumTxWithRefs(txs);
    patterns.push({
      merchantLabel: label,
      categoryId,
      transactionCount: txs.length,
      totalAmount: round2(total),
      sourceRefs: dedupeSourceRefs(refs),
    });
  }

  patterns.sort((a, b) => b.totalAmount - a.totalAmount || a.merchantLabel.localeCompare(b.merchantLabel));

  const evidence = buildEvidence({
    ruleId: 'analytics.detectFeePatterns',
    periodKey: ALL_PERIOD_KEY,
    computedAt,
    metrics: { expenseCount: expenses.length, feeCount: fees.length },
    sourceRefs: patterns.flatMap((p) => p.sourceRefs),
    ruleVersion: DETECTOR_RULE_VERSION,
  });

  return available(
    patterns,
    evidence,
    patterns.length === 0 ? ['No explicit fee, charge, or interest transactions were found.'] : [],
  );
}

/**
 * Detect cash spending gaps (the most conservative detector).
 *
 * Only explicit `cash`-type accounts count. No cash account →
 * insufficient_data (gap analysis is irrelevant). Cash account + no
 * transactions touching any cash account → one available gap per cash
 * account: "cash account exists but no corresponding cash transactions are
 * recorded" — a data-coverage gap, never proof of hidden spending. Cash
 * account + recorded activity → available, no gap.
 */
export function detectCashGaps(
  data: DetectorData,
  computedAt: string,
): IntelligenceSection<CashGapSummary[]> {
  const cashAccounts = data.accounts.filter((a) => a.type === 'cash' && !a.isArchived);
  if (cashAccounts.length === 0) {
    return unavailable([
      insufficient(
        'no_accounts',
        'Cash-gap analysis needs a cash-type account. No active cash account is tracked.',
        ['accounts'],
      ),
    ]);
  }

  const cashIds = new Set(cashAccounts.map((a) => a.id));
  const touched = new Set<string>();
  for (const t of data.transactions) {
    if (cashIds.has(t.accountId)) touched.add(t.accountId);
    if (t.toAccountId !== undefined && cashIds.has(t.toAccountId)) touched.add(t.toAccountId);
  }

  const gaps: CashGapSummary[] = [];
  for (const account of cashAccounts) {
    if (touched.has(account.id)) continue;
    gaps.push({
      accountTypeId: account.type,
      accountTypeLabel: account.name,
      suggestedCashAccountIds: [account.id],
      sourceRefs: dedupeSourceRefs([sourceRef('accounts', account.id)]),
    });
  }

  const evidence = buildEvidence({
    ruleId: 'analytics.detectCashGaps',
    periodKey: ALL_PERIOD_KEY,
    computedAt,
    metrics: { cashAccountCount: cashAccounts.length, gapCount: gaps.length },
    sourceRefs: [
      ...cashAccounts.map((a) => sourceRef('accounts', a.id)),
      ...gaps.flatMap((g) => g.sourceRefs),
    ],
    ruleVersion: DETECTOR_RULE_VERSION,
  });

  return available(
    gaps,
    evidence,
    gaps.length === 0
      ? ['Cash accounts exist and cash transactions are recorded — no coverage gap.']
      : ['Cash account exists but no corresponding cash transactions are recorded — a data-coverage gap, not proof of spending.'],
  );
}
