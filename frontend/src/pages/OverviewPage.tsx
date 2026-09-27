import { Gauge, Goal, Landmark, ShieldCheck, TrendingUp, WalletCards } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, StatCard } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { useDashboardMetrics } from '../features/dashboard/useDashboardMetrics';
import { useFinancialData } from '../features/dashboard/useFinancialData';
import { totalAccountBalance } from '../intelligence/finance';
import { formatCurrency, formatSignedCurrency } from '../lib/currency';
import { accountTypeLabel } from '../services/financial/accountService';

/**
 * Overview dashboard — Phase 2.
 *
 * Every figure rendered here comes from the Financial Intelligence Engine
 * over the real Financial Core state (profile + accounts + transactions +
 * recurring transactions). Where data is insufficient the engine returns
 * `null` and the page shows an honest empty state — values are computed,
 * never fabricated.
 */
export function OverviewPage() {
  const financial = useFinancialData();
  const metrics = useDashboardMetrics();

  const profile = financial.profile;
  const currencyCode = profile?.primaryCurrency ?? 'INR';
  const locale = profile?.locale;
  const activeAccounts = financial.accounts.filter((account) => !account.isArchived);
  const totalBalance = totalAccountBalance(activeAccounts);
  const flow = metrics.monthly;
  const netFlow = flow ? flow.income - flow.expenses : null;

  const health = metrics.financialHealthScore;
  const safeToSpend = metrics.safeToSpend?.safeToSpend ?? null;
  const projectedNetWorth = metrics.futureProjection.projectedNetWorth;
  const goalProgress = metrics.goalProgress.aggregate;
  const goalCount = metrics.goalProgress.activeGoalCount;
  const netWorth = metrics.netWorth;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Overview</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
            Your financial intelligence snapshot
          </h1>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-600">
          {metrics.hasData ? (
            <span className="inline-flex items-center gap-1.5">
              <WalletCards className="h-4 w-4" aria-hidden="true" />
              Live from your data
            </span>
          ) : (
            <Link to="/settings" className="text-sm font-medium text-teal-800 hover:underline">
              Set up your profile to begin →
            </Link>
          )}
        </div>
      </header>

      {profile === null ? (
        <EmptyState
          icon={Landmark}
          title="Your Financial Core is ready"
          description="Start in Settings: choose your name and primary currency, then create accounts and add your first transactions. Everything on this dashboard is then computed live from that data — never fabricated."
        />
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Total balance"
              value={formatCurrency(totalBalance, currencyCode, locale)}
              detail={`Across ${activeAccounts.length} active account${activeAccounts.length === 1 ? '' : 's'} (${financial.accounts.length} total).`}
              tone="success"
            />
            <StatCard
              label="Income this month"
              value={flow === null ? '—' : formatCurrency(flow.income, currencyCode, locale)}
              detail="Real income transactions recorded this month."
              tone="neutral"
            />
            <StatCard
              label="Expenses this month"
              value={flow === null ? '—' : formatCurrency(flow.expenses, currencyCode, locale)}
              detail="Real expense transactions recorded this month."
              tone="warning"
            />
            <StatCard
              label="Net cash flow"
              value={netFlow === null ? '—' : formatSignedCurrency(netFlow, currencyCode, locale)}
              detail="Income minus expenses. Transfers are never counted as income or expense."
              tone={netFlow === null || netFlow < 0 ? 'warning' : 'info'}
            />
          </section>

      <section className="grid gap-6 xl:grid-cols-[1.4fr_0.6fr]">
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-slate-900">Where am I?</h2>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
              Financial Digital Twin
            </span>
          </div>
          {netWorth ? (
            <>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-sm text-slate-500">Cash</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-900">{formatCurrency(netWorth.cash, currencyCode, locale)}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-sm text-slate-500">Investments</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-900">{formatCurrency(netWorth.investments, currencyCode, locale)}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-sm text-slate-500">Debt</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-900">{formatCurrency(netWorth.debt, currencyCode, locale)}</p>
                </div>
              </div>
              <div className="mt-6 flex h-48 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-gradient-to-r from-teal-50 via-white to-sky-50 p-4">
                <p className="max-w-sm text-center text-sm text-slate-500">
                  A net-worth trend line appears here once monthly snapshots are captured from connected data.
                </p>
              </div>
            </>
          ) : (
            <EmptyState
              icon={Landmark}
              title="No account data yet"
              description="Cash, investments, and debt figures are computed from your real accounts. They appear here as soon as you create an account — they are never hardcoded."
              className="py-10"
            />
          )}
        </Card>

        <Card>
          <h2 className="text-xl font-semibold text-slate-900">Account balances</h2>
          {activeAccounts.length === 0 ? (
            <EmptyState
              icon={WalletCards}
              title="No active accounts"
              description="Create your first account to see live balances here. Every number derives from your transactions."
              className="py-8"
            >
              <Link
                to="/accounts"
                className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-teal-800 hover:underline"
              >
                Create your first account →
              </Link>
            </EmptyState>
          ) : (
            <ul className="mt-3 divide-y divide-slate-200">
              {activeAccounts.map((account) => (
                <li key={account.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="text-sm text-slate-700">
                    {account.name}
                    <span className="text-xs text-slate-400"> · {accountTypeLabel(account.type)}</span>
                  </span>
                  <span className="text-sm font-semibold text-slate-900">
                    {formatCurrency(account.currentBalance, account.currencyCode, locale)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-2 xl:grid-cols-4">
        <Card>
          <div className="flex items-center gap-3">
            <Gauge className="h-5 w-5 text-violet-600" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-slate-900">Financial health score</h2>
          </div>
          <p className="mt-4 text-3xl font-semibold text-slate-900">
            {health === null ? '—' : `${health}/100`}
          </p>
          <p className="mt-2 text-sm text-slate-600">
            Weighted savings rate (40%), cash-buffer months (30%), and debt-to-income (30%) — one deterministic formula over your real data.
          </p>
          <p className="mt-2 text-xs text-slate-400">
            Appears once this month has both income and expenses recorded.
          </p>
        </Card>

        <Card>
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-emerald-600" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-slate-900">Safe-to-spend</h2>
          </div>
          <p className="mt-4 text-3xl font-semibold text-slate-900">
            {safeToSpend === null ? '—' : formatCurrency(safeToSpend, currencyCode, locale)}
          </p>
          <p className="mt-2 text-sm text-slate-600">
            Income − upcoming essential expenses − committed bills − budget commitments − savings commitments − emergency buffer.
          </p>
          <p className="mt-2 text-xs text-slate-400">
            Preliminary deterministic estimate — final production logic arrives with the goals & committed-bills phase.
          </p>
        </Card>

        <Card>
          <div className="flex items-center gap-3">
            <TrendingUp className="h-5 w-5 text-sky-600" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-slate-900">Future projection</h2>
          </div>
          <p className="mt-4 text-3xl font-semibold text-slate-900">
            {projectedNetWorth === null ? '—' : formatCurrency(projectedNetWorth, currencyCode, locale)}
          </p>
          <p className="mt-2 text-sm text-slate-600">
            Current net worth plus your monthly surplus over a 12-month horizon.
          </p>
        </Card>

        <Card>
          <div className="flex items-center gap-3">
            <Goal className="h-5 w-5 text-amber-600" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-slate-900">Goal progress</h2>
          </div>
          <p className="mt-4 text-3xl font-semibold text-slate-900">
            {goalProgress === null ? '—' : `${goalProgress}%`}
          </p>
          <p className="mt-2 text-sm text-slate-600">
            Computed from each goal's saved amount versus its target — never a preset percentage.
          </p>
          <p className="mt-2 text-xs text-slate-400">
            {goalCount === 0
              ? 'No active goals yet — create one from the Goals page.'
              : `Across ${goalCount} active goal${goalCount === 1 ? '' : 's'}.`}
          </p>
        </Card>
      </section>
        </>
      )}
    </div>
  );
}