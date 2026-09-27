/**
 * Phase 4C Advanced Financial Analytics types.
 *
 * These types represent the outputs of deterministic analytics functions and
 * hidden spending detectors. Every output is eventually wrapped in an
 * IntelligenceSection<T> (from src/types/intelligence.ts) so that each result
 * is either available with evidence or honestly marked insufficient_data.
 *
 * Phase 4C rule: these types describe *what* the analytics produce, not *how*.
 * The actual calculations live in analyticsEngine.ts and hiddenSpendingDetector.ts
 * as pure functions over already-loaded application data.
 */

import type { SourceRef } from '../types/intelligence';

/* ------------------------------------------------------------------ *
 * Period helpers
 * ------------------------------------------------------------------ */

/** A deterministic analysis period with human-readable label. */
export interface AnalyticsPeriod {
  key: string;
  label: string;
  start: string;
  end: string;
}

/* ------------------------------------------------------------------ *
 * Trend output types
 * ------------------------------------------------------------------ */

/** One data point in a trend line, with evidence traceability. */
export interface TrendPoint {
  period: AnalyticsPeriod;
  value: number;
  sourceRefs: SourceRef[];
}

/** One category breakdown point in a trend or snapshot. */
export interface CategoryTrendPoint {
  categoryId: string;
  categoryName: string | null;
  value: number;
  /** Share of total spending, 0-100 with one decimal (from sharePercent). */
  sharePercent: number;
  sourceRefs: SourceRef[];
}

/* ------------------------------------------------------------------ *
 * Budget utilization
 * ------------------------------------------------------------------ */

/** Per-budget spent vs limit for a given period. */
export interface BudgetUtilization {
  budgetId: string;
  categoryId: string | null;
  limit: number;
  spent: number;
  utilizationPercent: number | null;
  sourceRefs: SourceRef[];
}

/* ------------------------------------------------------------------ *
 * Recurring impact
 * ------------------------------------------------------------------ */

/** A single recurring transaction's monthly-equivalent impact. */
export interface RecurringImpact {
  recurringId: string;
  label: string;
  monthlyEquivalent: number;
  sourceRefs: SourceRef[];
}

/* ------------------------------------------------------------------ *
 * Financial-state changes (snapshot history)
 * ------------------------------------------------------------------ */

/** One snapshot-based data point in a financial-state trend. */
export interface SnapshotTrendPoint {
  capturedAt: string;
  dateLabel: string;
  netWorth: number | null;
  healthScore: number | null;
  safeToSpend: number | null;
  /** Savings rate percent (transaction-derived when snapshot fields are absent). */
  savingsRatePercent: number | null;
  sourceRefs: SourceRef[];
}

/* ------------------------------------------------------------------ *
 * Hidden spending detector outputs
 * ------------------------------------------------------------------ */

/** A detected cluster of small, possibly-overlooked charges. */
export interface SmallChargePattern {
  merchantLabel: string;
  categoryId: string | null;
  transactionCount: number;
  totalAmount: number;
  averageAmount: number;
  sourceRefs: SourceRef[];
}

/** A detected subscription-like periodic charge pattern. */
export interface SubscriptionPattern {
  merchantLabel: string;
  estimatedInterval: string;
  transactionCount: number;
  totalAmount: number;
  sourceRefs: SourceRef[];
}

/** Summary of spending that has no category assignment. */
export interface UncategorizedSpending {
  transactionCount: number;
  totalAmount: number;
  sourceRefs: SourceRef[];
}

/** A category consuming a disproportionate share of spending. */
export interface CategoryConcentration {
  categoryId: string;
  categoryName: string | null;
  sharePercent: number;
  totalSpent: number;
  sourceRefs: SourceRef[];
}

/** A detected fee, charge, or interest pattern. */
export interface FeePattern {
  merchantLabel: string;
  categoryId: string | null;
  transactionCount: number;
  totalAmount: number;
  sourceRefs: SourceRef[];
}

/** A gap where account types suggest cash spending but no cash transactions exist. */
export interface CashGapSummary {
  accountTypeId: string;
  accountTypeLabel: string;
  suggestedCashAccountIds: string[];
  sourceRefs: SourceRef[];
}
