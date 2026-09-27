import { useMemo } from 'react';
import { BarChart3 } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { useDashboardMetrics } from '../features/dashboard/useDashboardMetrics';
import { useFinancialData } from '../features/dashboard/useFinancialData';
import { useFinancialIntelligence } from '../features/intelligence/useFinancialIntelligence';
import { getCategoryName, defaultCurrency } from '../features/financial/selectors';
import { budgetUtilization, categoryTrend } from '../features/analytics/analyticsEngine';
import { financialStateChanges } from '../features/analytics/analyticsEngine';
import { incomeExpenseTrend, recurringImpact } from '../features/analytics/analyticsEngine';
import { detectCashGaps, detectCategoryConcentration } from '../features/analytics/hiddenSpendingDetector';
import { detectFeePatterns, detectSmallCharges } from '../features/analytics/hiddenSpendingDetector';
import { detectSubscriptionPatterns } from '../features/analytics/hiddenSpendingDetector';
import { detectUncategorizedSpending } from '../features/analytics/hiddenSpendingDetector';
import { isAvailable } from '../intelligence/section';
import { formatCurrency, formatSignedCurrency } from '../lib/currency';
import { IncomeExpensePeriods, SectionCard } from './AnalyticsSections';

/**
 * Analytics page (Phase 4C-5) — UI integration only.
 * Renders deterministic 4C-2/4C-3 analytics and 4C-4 detectors via useMemo.
 * No calculation logic lives here; components only format derived sections.
 */
export function AnalyticsPage() {
  const financial = useFinancialData();
  const metrics = useDashboardMetrics();
  const intelligence = useFinancialIntelligence();
  const currencyCode = defaultCurrency(financial);
  const locale = financial.profile?.locale;
  const flow = metrics.monthly;
  const computedAt = useMemo(() => new Date().toISOString(), []);

  const analyticsInput = useMemo(
    () => ({
      transactions: financial.transactions,
      categories: financial.categories,
      budgets: financial.budgets,
      goals: financial.goals,
      recurringTransactions: financial.recurringTransactions,
      accounts: financial.accounts,
      profile: financial.profile,
      snapshots: intelligence.snapshots,
      metrics,
    }),
    [financial, intelligence.snapshots, metrics],
  );

  const stateChanges = useMemo(
    () => financialStateChanges(analyticsInput, computedAt),
    [analyticsInput, computedAt],
  );
  const categorySection = useMemo(() => categoryTrend(analyticsInput, computedAt), [analyticsInput, computedAt]);
  const budgetSection = useMemo(() => budgetUtilization(analyticsInput, computedAt), [analyticsInput, computedAt]);
  const recurringSection = useMemo(() => recurringImpact(analyticsInput, computedAt), [analyticsInput, computedAt]);
  const incomeExpenseSection = useMemo(
    () => incomeExpenseTrend(analyticsInput, computedAt),
    [analyticsInput, computedAt],
  );
  const detectorInput = useMemo(
    () => ({
      transactions: financial.transactions,
      categories: financial.categories,
      recurringTransactions: financial.recurringTransactions,
      accounts: financial.accounts,
    }),
    [financial],
  );
  const smallCharges = useMemo(() => detectSmallCharges(detectorInput, computedAt), [detectorInput, computedAt]);
  const subscriptions = useMemo(
    () => detectSubscriptionPatterns(detectorInput, computedAt),
    [detectorInput, computedAt],
  );
  const uncategorized = useMemo(
    () => detectUncategorizedSpending(detectorInput, computedAt),
    [detectorInput, computedAt],
  );
  const concentration = useMemo(
    () => detectCategoryConcentration(detectorInput, computedAt),
    [detectorInput, computedAt],
  );
  const fees = useMemo(() => detectFeePatterns(detectorInput, computedAt), [detectorInput, computedAt]);
  const cashGaps = useMemo(() => detectCashGaps(detectorInput, computedAt), [detectorInput, computedAt]);

  const formatMoney = (value: number): string => formatCurrency(value, currencyCode, locale);
  const formatSigned = (value: number): string => formatSignedCurrency(value, currencyCode, locale);
  const netWorthPoints = isAvailable(stateChanges) ? stateChanges.data : null;
  const recurringTotal =
    isAvailable(recurringSection) && recurringSection.evidence !== null
      ? recurringSection.evidence.metrics['totalMonthlyCommitment']
      : undefined;
  const netFlowOverHistory = isAvailable(incomeExpenseSection)
    ? incomeExpenseSection.evidence.metrics['netFlow']
    : undefined;

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Analytics</p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">Behavior and trend intelligence</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          Deterministic trends and hidden-spending checks derived from your real data. Every number
          carries its evidence — nothing here is invented or predicted.
        </p>
      </header>

      {!flow ? (
        <EmptyState
          icon={BarChart3}
          title="No behavioural data yet"
          description="Income vs spending, savings rate, and buffer coverage are computed from your real transaction history once a data source is connected."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card>
            <h2 className="text-lg font-semibold text-slate-900">Income vs spending</h2>
            <div className="mt-4 space-y-3">
              <div>
                <div className="mb-2 flex justify-between text-sm text-slate-600">
                  <span>Income</span>
                  <span>{formatCurrency(flow.income, currencyCode, locale)}</span>
                </div>
                <div className="h-2.5 rounded-full bg-slate-200">
                  <div className="h-2.5 rounded-full bg-emerald-500" style={{ width: `${Math.min(100, Math.round((flow.income / Math.max(1, flow.income)) * 100))}%` }} />
                </div>
              </div>
              <div>
                <div className="mb-2 flex justify-between text-sm text-slate-600">
                  <span>Expenses</span>
                  <span>{formatCurrency(flow.expenses, currencyCode, locale)}</span>
                </div>
                <div className="h-2.5 rounded-full bg-slate-200">
                  <div className="h-2.5 rounded-full bg-sky-500" style={{ width: `${Math.min(100, Math.round((flow.expenses / Math.max(1, flow.income)) * 100))}%` }} />
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <h2 className="text-lg font-semibold text-slate-900">Savings rate</h2>
            <p className="mt-6 text-4xl font-semibold text-slate-900">{flow.savingsRate}%</p>
            <p className="mt-2 text-sm text-slate-600">
              {flow.savingsRate}% of this month's income kept after expenses.
            </p>
          </Card>

          <Card>
            <h2 className="text-lg font-semibold text-slate-900">Buffer coverage</h2>
            <p className="mt-6 text-4xl font-semibold text-slate-900">
              {metrics.bufferMonths === null ? '—' : `${metrics.bufferMonths} mo`}
            </p>
            <p className="mt-2 text-sm text-slate-600">
              Months of cash on hand against current monthly spending.
            </p>
          </Card>
        </div>
      )}

      <SectionCard
        title="Net worth trend"
        subtitle="Snapshot dates and recorded net-worth values."
        section={stateChanges}
        emptyTitle="Not enough snapshot history to show a trend."
      >
        {netWorthPoints !== null && (
          <ul className="divide-y divide-slate-100">
            {netWorthPoints.map((p) => (
              <li key={p.capturedAt} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="text-slate-600">{shortDate(p.capturedAt)}</span>
                <span className="font-medium text-slate-900">
                  {p.netWorth === null ? '—' : formatMoney(p.netWorth)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title="Health score trend"
        subtitle="Recorded financial health values from your snapshot history."
        section={stateChanges}
        emptyTitle="Not enough snapshot history to show a trend."
      >
        {netWorthPoints !== null && (
          <ul className="divide-y divide-slate-100">
            {netWorthPoints.map((p) => (
              <li key={p.capturedAt} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="text-slate-600">{shortDate(p.capturedAt)}</span>
                <span className="font-medium text-slate-900">
                  {p.healthScore === null ? '—' : `${p.healthScore}/100`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title="Safe-to-spend trend"
        subtitle="Recorded safe-to-spend values from your snapshot history."
        section={stateChanges}
        emptyTitle="Not enough snapshot history to show a trend."
      >
        {netWorthPoints !== null && (
          <ul className="divide-y divide-slate-100">
            {netWorthPoints.map((p) => (
              <li key={p.capturedAt} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="text-slate-600">{shortDate(p.capturedAt)}</span>
                <span className="font-medium text-slate-900">
                  {p.safeToSpend === null ? '—' : formatMoney(p.safeToSpend)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title="Spending by category"
        subtitle="Recorded expense totals and share per category, including uncategorized spending."
        section={categorySection}
        emptyTitle="No categorized expense data available."
      >
        {isAvailable(categorySection) && (
          <ul className="space-y-3">
            {categorySection.data.map((c) => (
              <li key={c.categoryId} className="text-sm">
                <div className="mb-1 flex justify-between gap-3">
                  <span className="font-medium text-slate-800">{c.categoryName ?? 'Uncategorized'}</span>
                  <span className="text-slate-600">
                    {formatMoney(c.value)} · {c.sharePercent}%
                  </span>
                </div>
                <div className="h-2 rounded-full bg-slate-200">
                  <div
                    className="h-2 rounded-full bg-teal-600"
                    style={{ width: `${Math.min(100, c.sharePercent)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title="Budget utilization"
        subtitle="Recorded spent vs limit per budget. Over 100% means recorded spend exceeds the limit."
        section={budgetSection}
        emptyTitle="No budgets available."
      >
        {isAvailable(budgetSection) && (
          <ul className="divide-y divide-slate-100">
            {budgetSection.data.map((b) => (
              <li key={b.budgetId} className="py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-slate-800">
                    {getCategoryName(financial, b.categoryId ?? undefined)}
                  </span>
                  <span
                    className={
                      b.utilizationPercent !== null && b.utilizationPercent > 100
                        ? 'font-semibold text-rose-700'
                        : 'text-slate-600'
                    }
                  >
                    {formatMoney(b.spent)} of {formatMoney(b.limit)}
                    {b.utilizationPercent === null
                      ? ' · —'
                      : ` · ${b.utilizationPercent}%${b.utilizationPercent > 100 ? ' · over budget' : ''}`}
                  </span>
                </div>
                {b.utilizationPercent !== null && (
                  <div className="mt-1 h-2 rounded-full bg-slate-200">
                    <div
                      className={
                        b.utilizationPercent > 100
                          ? 'h-2 rounded-full bg-rose-500'
                          : 'h-2 rounded-full bg-teal-600'
                      }
                      style={{ width: `${Math.min(100, b.utilizationPercent)}%` }}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title="Recurring spending"
        subtitle="Total monthly commitment and per-item monthly equivalents."
        section={recurringSection}
        emptyTitle="No recurring transactions available."
      >
        {isAvailable(recurringSection) && (
          <div className="space-y-3">
            {recurringTotal !== undefined && (
              <p className="text-sm text-slate-600">
                Total monthly commitment:{' '}
                <span className="font-semibold text-slate-900">{formatMoney(recurringTotal)}</span>
              </p>
            )}
            <ul className="divide-y divide-slate-100">
              {recurringSection.data.map((r) => (
                <li key={r.recurringId} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="font-medium text-slate-800">{r.label}</span>
                  <span className="text-slate-600">{formatMoney(r.monthlyEquivalent)}/mo</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Income vs expense over time"
        subtitle="Recorded income, expenses and net flow per period."
        section={incomeExpenseSection}
        emptyTitle="No transaction data available."
      >
        {isAvailable(incomeExpenseSection) && (
          <div className="space-y-3">
            {netFlowOverHistory !== undefined && (
              <p className="text-sm text-slate-600">
                Net flow over the covered history:{' '}
                <span className="font-semibold text-slate-900">{formatSigned(netFlowOverHistory)}</span>
              </p>
            )}
            <IncomeExpensePeriods
              income={incomeExpenseSection.data.income}
              expenses={incomeExpenseSection.data.expenses}
              formatMoney={formatMoney}
              formatSigned={formatSigned}
            />
          </div>
        )}
      </SectionCard>

      <div className="space-y-2 pt-2">
        <h2 className="text-xl font-semibold text-slate-900">Hidden spending checks</h2>
        <p className="max-w-2xl text-sm text-slate-600">
          Mechanically observable patterns only. Each check reports what was recorded — never advice,
          and never certainty beyond the evidence.
        </p>
      </div>

      <SectionCard
        title="Small recurring charges"
        subtitle="Repeated small charges to the same payee that are easy to overlook."
        section={smallCharges}
        emptyTitle="No transaction data available."
        emptyResultText="No pattern detected — no repeated small-charge clusters were observed."
      >
        {isAvailable(smallCharges) && (
          <ul className="divide-y divide-slate-100">
            {smallCharges.data.map((s) => (
              <li key={s.merchantLabel} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="font-medium text-slate-800">
                  {s.merchantLabel} <span className="font-normal text-slate-500">· {s.transactionCount}×</span>
                </span>
                <span className="text-slate-600">
                  {formatMoney(s.totalAmount)} · avg {formatMoney(s.averageAmount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title="Subscription-like patterns"
        subtitle="Charges repeating at approximately regular weekly, monthly, or yearly intervals."
        section={subscriptions}
        emptyTitle="No transaction data available."
        emptyResultText="No pattern detected — no subscription-like intervals were observed."
      >
        {isAvailable(subscriptions) && (
          <ul className="divide-y divide-slate-100">
            {subscriptions.data.map((s) => (
              <li key={s.merchantLabel} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="font-medium text-slate-800">
                  {s.merchantLabel}{' '}
                  <span className="font-normal text-slate-500">
                    · subscription-like pattern detected ({s.estimatedInterval}, {s.transactionCount}×)
                  </span>
                </span>
                <span className="text-slate-600">{formatMoney(s.totalAmount)}</span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title="Uncategorized spending"
        subtitle="Recorded expenses without a usable category assignment."
        section={uncategorized}
        emptyTitle="No transaction data available."
        emptyResultText="No pattern detected — no uncategorized spending found."
      >
        {isAvailable(uncategorized) && uncategorized.data.transactionCount > 0 && (
          <p className="text-sm text-slate-600">
            <span className="font-semibold text-slate-900">{uncategorized.data.transactionCount}</span>{' '}
            transactions ·{' '}
            <span className="font-semibold text-slate-900">{formatMoney(uncategorized.data.totalAmount)}</span>
          </p>
        )}
      </SectionCard>

      <SectionCard
        title="Category concentration"
        subtitle="Categories representing a large share of recorded expenses."
        section={concentration}
        emptyTitle="No transaction data available."
        emptyResultText="No pattern detected — no category reaches the concentration threshold."
      >
        {isAvailable(concentration) && (
          <ul className="divide-y divide-slate-100">
            {concentration.data.map((c) => (
              <li key={c.categoryId} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="font-medium text-slate-800">
                  {c.categoryName ?? 'Uncategorized'}{' '}
                  <span className="font-normal text-slate-500">
                    · represents {c.sharePercent}% of recorded expenses
                  </span>
                </span>
                <span className="text-slate-600">{formatMoney(c.totalSpent)}</span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title="Fee and charge patterns"
        subtitle="Explicitly labelled fees, charges, interest, or penalties."
        section={fees}
        emptyTitle="No transaction data available."
        emptyResultText="No pattern detected — no explicit fee transactions were found."
      >
        {isAvailable(fees) && (
          <ul className="divide-y divide-slate-100">
            {fees.data.map((f) => (
              <li key={f.merchantLabel} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="font-medium text-slate-800">
                  {f.merchantLabel} <span className="font-normal text-slate-500">· {f.transactionCount}×</span>
                </span>
                <span className="text-slate-600">{formatMoney(f.totalAmount)}</span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title="Cash tracking gaps"
        subtitle="Cash accounts with no recorded cash transactions — a data-coverage gap, not proof of spending."
        section={cashGaps}
        emptyTitle="Cash-gap analysis needs a cash-type account."
        emptyResultText="No pattern detected — cash accounts have recorded cash transactions."
      >
        {isAvailable(cashGaps) && (
          <ul className="divide-y divide-slate-100">
            {cashGaps.data.map((g) => (
              <li key={g.suggestedCashAccountIds.join(',')} className="py-2 text-sm text-slate-600">
                Cash account has no recorded cash transactions:{' '}
                <span className="font-medium text-slate-800">{g.accountTypeLabel}</span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

/** Snapshot timestamps are ISO strings; the first 10 characters are the date. */
function shortDate(value: string): string {
  return value.length >= 10 ? value.slice(0, 10) : value;
}