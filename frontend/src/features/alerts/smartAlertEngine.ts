import type {
  Evidence,
  InsufficientDataReason,
  IntelligenceSection,
  SourceRef,
} from '../../types/intelligence';
import { available, mergeReasons, unavailable } from '../../intelligence/section';
import { ALL_PERIOD_KEY, buildEvidence } from '../../intelligence/evidence';

/**
 * Phase 4D-2 smart alert engine.
 *
 * Pure rule evaluation (R1-R4) over intelligence sections that Phase 4C
 * already derived. The engine reads only the input object handed to it:
 *
 *   R1 budget exceeded ........ utilization strictly above 100%
 *   R2 hidden spending ........ only sections marked available carry data;
 *                               empty data raises nothing, insufficient_data
 *                               contributes nothing
 *   R3 financial state change . two or more snapshots with a real difference
 *   R4 negative net flow ...... completed periods only; the period of
 *                               computedAt is excluded because it is still
 *                               in progress
 *
 * Guarantees: identical input -> byte-identical output; one alert per
 * stableKey; every alert carries its source section's evidence object
 * unchanged; a section that is insufficient_data contributes nothing.
 *
 * Output text states observed numbers only.
 */

/** Rule version stamped on the section evidence this engine produces. */
export const SMART_ALERT_RULE_VERSION = '4d.1';

export type SmartAlertRuleId =
  | 'budget_exceeded'
  | 'hidden_spending'
  | 'financial_state_change'
  | 'negative_net_flow';

export interface SmartAlert {
  /** Deterministic identity: rule + subject. One alert per stableKey. */
  stableKey: string;
  ruleId: SmartAlertRuleId;
  severity: 'info' | 'notice' | 'warning' | 'critical';
  title: string;
  explanation: string;
  periodKey: string;
  metrics: Record<string, number>;
  /** The source section's evidence object, reused unchanged. */
  evidence: Evidence;
}

export interface SmartAlertCategory {
  id: string;
  name: string;
}

export interface SmartAlertBudget {
  budgetId: string;
  categoryId: string | null;
  limit: number;
  spent: number;
  utilizationPercent: number | null;
  sourceRefs: SourceRef[];
}

export interface SmartAlertSmallCharge {
  merchantLabel: string;
  categoryId: string | null;
  transactionCount: number;
  totalAmount: number;
  sourceRefs: SourceRef[];
}

export interface SmartAlertCashGap {
  accountTypeId: string;
  accountTypeLabel: string;
  suggestedCashAccountIds: string[];
  sourceRefs: SourceRef[];
}

export interface SmartAlertStatePoint {
  capturedAt: string;
  netWorth: number | null;
  financialHealthScore: number | null;
  safeToSpend: number | null;
}

export interface SmartAlertFlowPoint {
  period: { key: string; label: string };
  value: number;
  sourceRefs: SourceRef[];
}

export interface SmartAlertCashFlow {
  income: SmartAlertFlowPoint[];
  expenses: SmartAlertFlowPoint[];
}

export interface SmartAlertInput {
  computedAt: string;
  currencyCode: string;
  locale: string;
  categories: SmartAlertCategory[];
  budgets: IntelligenceSection<SmartAlertBudget[]>;
  smallCharges: IntelligenceSection<SmartAlertSmallCharge[]>;
  cashGaps: IntelligenceSection<SmartAlertCashGap[]>;
  financialState: IntelligenceSection<SmartAlertStatePoint[]>;
  cashFlow: IntelligenceSection<SmartAlertCashFlow>;
}

const BUDGET_THRESHOLD_PERCENT = 100;
const MIN_STATE_POINTS = 2;

function categoryName(categories: readonly SmartAlertCategory[], id: string | null): string | null {
  if (!id) return null;
  const match = categories.find((category) => category.id === id);
  return match ? match.name : null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Deterministic `YYYY-MM` period key from an ISO timestamp. */
function periodKeyOfIso(iso: string): string {
  return iso.slice(0, 7);
}

/** First-seen stableKey dedupe: one alert per key, input order preserved. */
function dedupe(alerts: SmartAlert[]): SmartAlert[] {
  const seen = new Set<string>();
  const out: SmartAlert[] = [];
  for (const alert of alerts) {
    if (seen.has(alert.stableKey)) continue;
    seen.add(alert.stableKey);
    out.push(alert);
  }
  return out;
}

interface PendingAlert {
  stableKey: string;
  ruleId: SmartAlertRuleId;
  severity: SmartAlert['severity'];
  title: string;
  explanation: string;
  periodKey: string;
  metrics: Record<string, number>;
  evidence: Evidence;
}

function budgetAlerts(input: SmartAlertInput): PendingAlert[] {
  if (input.budgets.status !== 'available') return [];
  const out: PendingAlert[] = [];
  for (const budget of input.budgets.data) {
    const percent = budget.utilizationPercent;
    if (percent === null || percent <= BUDGET_THRESHOLD_PERCENT) continue;
    const name = categoryName(input.categories, budget.categoryId) ?? budget.budgetId;
    out.push({
      stableKey: `budget_exceeded:${budget.budgetId}`,
      ruleId: 'budget_exceeded',
      severity: 'warning',
      title: `Budget exceeded: ${name}`,
      explanation:
        `Recorded spending of ${budget.spent} against a limit of ${budget.limit} ` +
        `is ${round1(percent)}% of the ${input.currencyCode} budget.`,
      periodKey: input.budgets.evidence.periodKey,
      metrics: {
        utilizationPercent: round1(percent),
        limit: budget.limit,
        spent: budget.spent,
      },
      evidence: input.budgets.evidence,
    });
  }
  return out;
}

function hiddenSpendingAlerts(input: SmartAlertInput): PendingAlert[] {
  const out: PendingAlert[] = [];
  if (input.smallCharges.status === 'available') {
    for (const charge of input.smallCharges.data) {
      const name = categoryName(input.categories, charge.categoryId) ?? charge.categoryId ?? charge.merchantLabel;
      out.push({
        stableKey: `hidden_spending:small_charges:${charge.merchantLabel}:${charge.categoryId ?? 'none'}`,
        ruleId: 'hidden_spending',
        severity: 'notice',
        title: `Frequent small charges: ${charge.merchantLabel}`,
        explanation:
          `${charge.transactionCount} recorded charges totalling ${charge.totalAmount} ` +
          `${input.currencyCode} under ${name}.`,
        periodKey: input.smallCharges.evidence.periodKey,
        metrics: {
          transactionCount: charge.transactionCount,
          totalAmount: charge.totalAmount,
        },
        evidence: input.smallCharges.evidence,
      });
    }
  }
  if (input.cashGaps.status === 'available') {
    for (const gap of input.cashGaps.data) {
      out.push({
        stableKey: `hidden_spending:cash_gap:${gap.accountTypeId}`,
        ruleId: 'hidden_spending',
        severity: 'notice',
        title: `No recorded cash spending: ${gap.accountTypeLabel}`,
        explanation:
          `Account type ${gap.accountTypeLabel} suggests cash spending, but no ` +
          `cash transactions are recorded for it.`,
        periodKey: input.cashGaps.evidence.periodKey,
        metrics: {
          suggestedCashAccounts: gap.suggestedCashAccountIds.length,
        },
        evidence: input.cashGaps.evidence,
      });
    }
  }
  return out;
}

function stateChangeAlerts(input: SmartAlertInput): PendingAlert[] {
  if (input.financialState.status !== 'available') return [];
  const points = input.financialState.data;
  if (points.length < MIN_STATE_POINTS) return [];

  // Oldest -> newest by capturedAt, then compare the endpoints.
  const sorted = [...points].sort((a, b) => (a.capturedAt < b.capturedAt ? -1 : a.capturedAt > b.capturedAt ? 1 : 0));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const netWorthChanged =
    first.netWorth !== null && last.netWorth !== null && first.netWorth !== last.netWorth;
  const scoreChanged =
    first.financialHealthScore !== null &&
    last.financialHealthScore !== null &&
    first.financialHealthScore !== last.financialHealthScore;
  const safeChanged =
    first.safeToSpend !== null && last.safeToSpend !== null && first.safeToSpend !== last.safeToSpend;
  if (!netWorthChanged && !scoreChanged && !safeChanged) return [];

  const metrics: Record<string, number> = { snapshotCount: points.length };
  const moved: string[] = [];
  if (netWorthChanged) {
    metrics.netWorthFrom = first.netWorth as number;
    metrics.netWorthTo = last.netWorth as number;
    moved.push('net worth');
  }
  if (scoreChanged) {
    metrics.healthScoreFrom = first.financialHealthScore as number;
    metrics.healthScoreTo = last.financialHealthScore as number;
    moved.push('health score');
  }
  if (safeChanged) {
    metrics.safeToSpendFrom = first.safeToSpend as number;
    metrics.safeToSpendTo = last.safeToSpend as number;
    moved.push('safe to spend');
  }

  return [
    {
      stableKey: 'financial_state_change:all',
      ruleId: 'financial_state_change',
      severity: 'info',
      title: 'Financial state changed',
      explanation:
        `Across ${points.length} recorded snapshots (${first.capturedAt.slice(0, 10)} to ` +
        `${last.capturedAt.slice(0, 10)}), ${moved.join(' and ')} moved.`,
      periodKey: ALL_PERIOD_KEY,
      metrics,
      evidence: input.financialState.evidence,
    },
  ];
}

function negativeNetFlowAlerts(input: SmartAlertInput): PendingAlert[] {
  if (input.cashFlow.status !== 'available') return [];

  const currentPeriod = periodKeyOfIso(input.computedAt);
  const incomeByPeriod = new Map<string, number>();
  const expensesByPeriod = new Map<string, number>();
  for (const point of input.cashFlow.data.income) {
    incomeByPeriod.set(point.period.key, (incomeByPeriod.get(point.period.key) ?? 0) + point.value);
  }
  for (const point of input.cashFlow.data.expenses) {
    expensesByPeriod.set(point.period.key, (expensesByPeriod.get(point.period.key) ?? 0) + point.value);
  }

  const out: PendingAlert[] = [];
  for (const [periodKey, income] of incomeByPeriod) {
    if (periodKey >= currentPeriod) continue;
    const expenses = expensesByPeriod.get(periodKey);
    if (expenses === undefined || expenses <= income) continue;
    out.push({
      stableKey: `negative_net_flow:${periodKey}`,
      ruleId: 'negative_net_flow',
      severity: 'warning',
      title: `Negative net flow: ${periodKey}`,
      explanation:
        `Recorded expenses of ${expenses} exceeded recorded income of ${income} ` +
        `by ${expenses - income} ${input.currencyCode} in ${periodKey}.`,
      periodKey,
      metrics: { income, expenses, netFlow: income - expenses },
      evidence: input.cashFlow.evidence,
    });
  }
  return out;
}

/** Derive deterministic alerts from already-derived Phase 4 intelligence. */
export function deriveSmartAlerts(input: SmartAlertInput): IntelligenceSection<SmartAlert[]> {
  const sections = [input.budgets, input.smallCharges, input.cashGaps, input.financialState, input.cashFlow] as const;
  const reasons: InsufficientDataReason[] = [];
  let hasAvailableInput = false;
  for (const section of sections) {
    if (section.status === 'available') hasAvailableInput = true;
    else reasons.push(...section.reasons);
  }

  if (!hasAvailableInput) {
    return unavailable(mergeReasons(reasons));
  }

  const alerts = dedupe([
    ...budgetAlerts(input),
    ...hiddenSpendingAlerts(input),
    ...stateChangeAlerts(input),
    ...negativeNetFlowAlerts(input),
  ]).map((alert): SmartAlert => ({ ...alert }));
  const sourceRefs = sections.flatMap((section) =>
    section.status === 'available' ? section.evidence.sourceRefs : [],
  );
  const evidence = buildEvidence({
    ruleId: 'alerts.smartAlertEngine',
    ruleVersion: SMART_ALERT_RULE_VERSION,
    periodKey: ALL_PERIOD_KEY,
    computedAt: input.computedAt,
    metrics: { alertCount: alerts.length },
    thresholds: { budgetUtilizationPercent: BUDGET_THRESHOLD_PERCENT, minimumStatePoints: MIN_STATE_POINTS },
    sourceRefs,
  });
  return available(alerts, evidence);
}

