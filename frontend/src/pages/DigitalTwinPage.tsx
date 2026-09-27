import { Activity, AlertTriangle, Camera, HeartPulse, Link2, UserRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card, StatCard } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { useFinancialData } from '../features/dashboard/useFinancialData';
import { defaultCurrency } from '../features/financial/selectors';
import { accountTypeLabel } from '../services/financial/accountService';
import { useFinancialIntelligence } from '../features/intelligence/useFinancialIntelligence';
import { countByCollection } from '../intelligence/evidence';
import { isAvailable } from '../intelligence/section';
import type {
  TwinBehaviourData,
  TwinHealthData,
  TwinRelationshipsData,
  TwinStateData,
} from '../intelligence/twin';
import { formatCurrency, formatSignedCurrency } from '../lib/currency';
import type { AccountType } from '../types/financial';
import type { Evidence, InsufficientDataReason, IntelligenceSection } from '../types/intelligence';

/**
 * Digital Twin page (Phase 4B) — progressive disclosure: State → Behaviour →
 * Health → Relationships. Every value renders from the derived twin context
 * (built ONCE per financial state change by the provider); every available
 * section shows the evidence that produced it, and every insufficient section
 * explains why it is empty instead of showing a fabricated number.
 */
export function DigitalTwinPage() {
  const data = useFinancialData();
  const intelligence = useFinancialIntelligence();
  const currency = defaultCurrency(data);
  const locale = data.profile?.locale;
  const format = (value: number): string => formatCurrency(value, currency, locale);
  const formatSigned = (value: number): string => formatSignedCurrency(value, currency, locale);

  if (!data.isHydrated) {
    return (
      <div className="space-y-6">
        <PageHeader />
        <div className="flex justify-center rounded-2xl border-2 border-dashed border-slate-200 py-16 text-sm text-slate-400">
          Building your twin…
        </div>
      </div>
    );
  }

  if (data.lastError !== null) {
    return (
      <div className="space-y-6">
        <PageHeader />
        <EmptyState icon={AlertTriangle} title="Couldn't load your financial data" description={data.lastError} />
      </div>
    );
  }

  const { twin, snapshots, snapshotsLoading, snapshotError, capturing, captureError, actions } = intelligence;
  const healthData = isAvailable(twin.health) ? twin.health.data : null;
  const netWorth = healthData?.netWorth?.netWorth ?? null;
  const safeToSpend = healthData?.safeToSpend?.safeToSpend ?? null;
  const healthScore = healthData?.financialHealthScore ?? null;
  const bufferMonths = healthData?.bufferMonths ?? null;
  const latestSnapshot = snapshots[0] ?? null;

  return (
    <div className="space-y-6">
      <PageHeader />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Net worth"
          value={netWorth === null ? '—' : format(netWorth)}
          detail="Cash + investments − debt, derived from your accounts."
        />
        <StatCard
          label="Safe to Spend"
          value={safeToSpend === null ? '—' : format(safeToSpend)}
          detail="Income minus committed costs, savings and your emergency buffer."
          tone="info"
        />
        <StatCard
          label="Financial health"
          value={healthScore === null ? '—' : `${healthScore}/100`}
          detail="Savings rate, buffer and debt blended by the deterministic engine."
          tone={healthScore === null ? 'neutral' : healthScore >= 70 ? 'success' : 'warning'}
        />
        <StatCard
          label="Cash buffer"
          value={bufferMonths === null ? '—' : `${bufferMonths} months`}
          detail="Months of this month's expenses your cash could cover."
        />
      </div>

      <Card className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Twin memory</h2>
          <p className="mt-1 text-sm text-slate-600">
            {snapshots.length} snapshot{snapshots.length === 1 ? '' : 's'} captured
            {latestSnapshot === null ? ' · none yet' : ` · latest ${shortIso(latestSnapshot.capturedAt)}`}
            {snapshotsLoading ? ' · loading…' : ''}
          </p>
          {snapshotError !== null && (
            <p role="alert" className="mt-1 text-xs font-medium text-rose-700">
              {snapshotError}
            </p>
          )}
          {captureError !== null && (
            <p role="alert" className="mt-1 text-xs font-medium text-rose-700">
              {captureError}
            </p>
          )}
          {healthData?.financialHealthScore == null && (
            <p className="mt-1 text-xs text-slate-500">
              A snapshot needs this month's income, expenses and an account balance before it can be captured.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void actions.captureSnapshot()}
          disabled={capturing || snapshotsLoading}
          className="flex items-center gap-2 rounded-xl bg-teal-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Camera className="h-4 w-4" aria-hidden="true" />
          {capturing ? 'Capturing…' : 'Capture snapshot'}
        </button>
      </Card>

      <TwinSection
        title="State"
        subtitle="Where you are right now — accounts, this month's flow and commitments."
        icon={UserRound}
        section={twin.state}
      >
        {isAvailable(twin.state) ? (
          <StateContent data={twin.state.data} format={format} formatSigned={formatSigned} />
        ) : null}
      </TwinSection>

      <TwinSection
        title="Behaviour"
        subtitle="What you actually did this month — spending structure and savings outcome."
        icon={Activity}
        section={twin.behaviour}
      >
        {isAvailable(twin.behaviour) ? (
          <BehaviourContent data={twin.behaviour.data} format={format} formatSigned={formatSigned} />
        ) : null}
      </TwinSection>

      <TwinSection
        title="Health"
        subtitle="How the numbers score — buffer, Safe-to-Spend and the engine's health score."
        icon={HeartPulse}
        section={twin.health}
      >
        {isAvailable(twin.health) ? <HealthContent data={twin.health.data} format={format} /> : null}
      </TwinSection>

      <TwinSection
        title="Relationships"
        subtitle="How your accounts, categories, budgets, goals and recurring commitments connect."
        icon={Link2}
        section={twin.relationships}
      >
        {isAvailable(twin.relationships) ? (
          <RelationshipsContent data={twin.relationships.data} format={format} formatSigned={formatSigned} />
        ) : null}
      </TwinSection>
    </div>
  );
}

function PageHeader() {
  return (
    <div>
      <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Digital Twin</p>
      <h1 className="mt-2 text-3xl font-semibold text-slate-900">Your financial digital twin</h1>
      <p className="mt-2 max-w-2xl text-sm text-slate-600">
        A live, deterministic representation of your finances. Every number is derived from your real data and
        carries the evidence that produced it — nothing here is invented.
      </p>
    </div>
  );
}

/* --------------------------------------------------------------------------- */
/* Shared section primitives                                                    */
/* --------------------------------------------------------------------------- */

function TwinSection({
  title,
  subtitle,
  icon: Icon,
  section,
  children,
}: {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  section: IntelligenceSection<unknown>;
  children: ReactNode;
}) {
  const ok = isAvailable(section);
  return (
    <Card className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
          <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
        </div>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      </div>
      {ok ? (
        <>
          {children}
          <EvidenceLine evidence={section.evidence} />
        </>
      ) : (
        <InsufficientBlock reasons={section.reasons} />
      )}
    </Card>
  );
}

/** The explicit "what data produced this" affordance (Phase 4A §13/§15). */
function EvidenceLine({ evidence }: { evidence: Evidence }) {
  const sources = countByCollection(evidence.sourceRefs);
  const sourceText =
    Object.entries(sources)
      .map(([collection, count]) => `${collection.replace('sources.', '')} ${count}`)
      .join(' · ') || 'no row-level sources';
  return (
    <p className="border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-500">
      Evidence: <span className="font-medium text-slate-600">{evidence.ruleId}</span> v{evidence.ruleVersion} ·
      window {evidence.periodKey} · computed {shortIso(evidence.computedAt)} · from {sourceText}
    </p>
  );
}

function InsufficientBlock({ reasons }: { reasons: InsufficientDataReason[] }) {
  return (
    <div className="space-y-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
      {reasons.map((reason) => (
        <p key={reason.code} className="text-sm text-slate-600">
          <span className="font-medium text-slate-800">{reason.message}</span>
          {reason.missing.length > 0 && (
            <span className="text-slate-500"> (needs: {reason.missing.join(', ')})</span>
          )}
        </p>
      ))}
    </div>
  );
}

function RelationshipList({
  title,
  count,
  empty,
  children,
}: {
  title: string;
  count: number;
  empty: string;
  children: ReactNode;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {count === 0 ? <p className="mt-1 text-slate-500">{empty}</p> : <ul className="mt-1 space-y-1">{children}</ul>}
    </div>
  );
}

function shortIso(value: string): string {
  return value.length >= 10 ? value.slice(0, 10) : value;
}

/* --------------------------------------------------------------------------- */
/* Section content                                                              */
/* --------------------------------------------------------------------------- */

interface SectionFormat {
  format(value: number): string;
  formatSigned(value: number): string;
}

function StateContent({ data: state, format, formatSigned }: { data: TwinStateData } & SectionFormat) {
  const byType = Object.entries(state.accounts.byType)
    .map(([type, count]) => `${accountTypeLabel(type as AccountType)} × ${count}`)
    .join(' · ');
  return (
    <div className="space-y-2 text-sm text-slate-700">
      <div className="grid gap-2 sm:grid-cols-2">
        <p>
          Identity: {state.identity.profileName ?? 'No profile yet'} · currency {state.currencyCode ?? 'not set'}
        </p>
        <p>
          Pay frequency: {state.identity.payFrequency ?? 'not set'} · expected monthly income:{' '}
          {state.identity.expectedMonthlyIncome === null ? 'not set' : format(state.identity.expectedMonthlyIncome)}
        </p>
      </div>
      <p>
        Accounts: {state.accounts.total} total, {state.accounts.active} active
        {byType.length > 0 ? ` (${byType})` : ''}
      </p>
      <p>
        This month: income {state.monthlyFlow === null ? '—' : format(state.monthlyFlow.income)} · expenses{' '}
        {state.monthlyFlow === null ? '—' : format(state.monthlyFlow.expenses)} · surplus{' '}
        {state.monthlySurplus === null ? '—' : formatSigned(state.monthlySurplus)}
      </p>
      <p>
        Recurring commitments:{' '}
        {state.recurringCommitments.monthlyTotal === null
          ? '—'
          : `${format(state.recurringCommitments.monthlyTotal)}/month`}{' '}
        across {state.recurringCommitments.activeCount} active schedule
        {state.recurringCommitments.activeCount === 1 ? '' : 's'}
      </p>
      <p>
        Budgets: {state.budgets.count} planned · committed{' '}
        {state.budgets.committedMonthly === null ? '—' : `${format(state.budgets.committedMonthly)}/month`}
      </p>
      <p>
        Goals: {state.goals.activeCount} active · average progress{' '}
        {state.goals.aggregateProgress === null ? '—' : `${state.goals.aggregateProgress}%`}
      </p>
    </div>
  );
}

function BehaviourContent({ data: behaviour, format, formatSigned }: { data: TwinBehaviourData } & SectionFormat) {
  return (
    <div className="space-y-3 text-sm text-slate-700">
      <p>
        {behaviour.expenseCount} expense{behaviour.expenseCount === 1 ? '' : 's'} totalling{' '}
        {format(behaviour.expenseTotal)} in {behaviour.periodKey}.
      </p>
      <ul className="space-y-2">
        {behaviour.spendingByCategory.map((entry) => (
          <li key={entry.categoryId ?? 'uncategorized'}>
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-slate-800">{entry.label}</span>
              <span>
                {format(entry.total)} · {entry.shareOfExpenses}%
              </span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-slate-100">
              <div
                className="h-1.5 rounded-full bg-teal-600"
                style={{ width: `${Math.min(100, entry.shareOfExpenses)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
      <p>
        Recurring commitments:{' '}
        {behaviour.recurringMonthlyEquivalent === null ? '—' : `${format(behaviour.recurringMonthlyEquivalent)}/month`}
        {behaviour.recurringShareOfExpenses === null ? '' : ` (${behaviour.recurringShareOfExpenses}% of this month's expenses)`}
      </p>
      <p>
        Savings rate: {behaviour.savingsRate === null ? '—' : `${behaviour.savingsRate}%`} · monthly surplus{' '}
        {behaviour.monthlySurplus === null ? '—' : formatSigned(behaviour.monthlySurplus)}
      </p>
    </div>
  );
}

function HealthContent({ data: health, format }: { data: TwinHealthData; format: (value: number) => string }) {
  return (
    <div className="space-y-3 text-sm text-slate-700">
      <div className="grid gap-2 sm:grid-cols-2">
        <p>
          Net worth: {health.netWorth === null ? '—' : format(health.netWorth.netWorth)} (cash{' '}
          {health.netWorth === null ? '—' : format(health.netWorth.cash)} · investments{' '}
          {health.netWorth === null ? '—' : format(health.netWorth.investments)} · debt{' '}
          {health.netWorth === null ? '—' : format(health.netWorth.debt)})
        </p>
        <p>
          Health score:{' '}
          {health.financialHealthScore === null ? 'not derivable yet' : `${health.financialHealthScore}/100`} ·
          buffer {health.bufferMonths === null ? 'not derivable yet' : `${health.bufferMonths} months`}
        </p>
      </div>
      {health.safeToSpend === null ? (
        <p>Safe-to-Spend: not derivable yet — it needs this month's activity.</p>
      ) : (
        <ul className="space-y-1">
          <li>Income: {format(health.safeToSpend.income)}</li>
          <li>Upcoming essential expenses: −{format(health.safeToSpend.upcomingEssentialExpenses)}</li>
          <li>Committed bills: −{format(health.safeToSpend.committedBills)}</li>
          <li>Budget commitments: −{format(health.safeToSpend.budgetCommitments)}</li>
          <li>Emergency buffer (3 months): −{format(health.safeToSpend.emergencyBuffer)}</li>
          <li className="font-semibold text-slate-900">Safe to Spend: {format(health.safeToSpend.safeToSpend)}</li>
        </ul>
      )}
      <p>
        Savings rate: {health.savingsRate === null ? '—' : `${health.savingsRate}%`} · goals:{' '}
        {health.goalProgress.activeGoalCount} active · average progress{' '}
        {health.goalProgress.aggregate === null ? '—' : `${health.goalProgress.aggregate}%`}
      </p>
    </div>
  );
}

function RelationshipsContent({
  data: relationships,
  format,
  formatSigned,
}: {
  data: TwinRelationshipsData;
} & SectionFormat) {
  return (
    <div className="space-y-4 text-sm text-slate-700">
      <RelationshipList
        title="Accounts ↔ transactions"
        count={relationships.accountLinks.length}
        empty="No active accounts to link yet."
      >
        {relationships.accountLinks.map((link) => (
          <li key={link.accountId} className="flex items-center justify-between gap-3">
            <span className="font-medium text-slate-800">{link.label}</span>
            <span>
              {link.transactionCount} transactions · in {formatSigned(link.inflow)} · out {format(link.outflow)}
            </span>
          </li>
        ))}
      </RelationshipList>

      <RelationshipList
        title="Categories ↔ expenses"
        count={relationships.categoryLinks.length}
        empty="No expenses recorded yet."
      >
        {relationships.categoryLinks.map((link) => (
          <li key={link.categoryId ?? 'uncategorized'} className="flex items-center justify-between gap-3">
            <span className="font-medium text-slate-800">{link.label}</span>
            <span>
              {link.transactionCount} expenses · {format(link.amount)}
            </span>
          </li>
        ))}
      </RelationshipList>

      <RelationshipList title="Budgets ↔ spending" count={relationships.budgetLinks.length} empty="No budgets planned yet.">
        {relationships.budgetLinks.map((link) => (
          <li key={link.budgetId} className="flex items-center justify-between gap-3">
            <span className="font-medium text-slate-800">{link.label}</span>
            <span>
              {format(link.spent)} of {format(link.limit)}
              {link.utilization === null ? '' : ` · ${link.utilization}% used`}
            </span>
          </li>
        ))}
      </RelationshipList>

      <RelationshipList title="Goals ↔ contributions" count={relationships.goalLinks.length} empty="No active goals yet.">
        {relationships.goalLinks.map((link) => (
          <li key={link.goalId} className="flex items-center justify-between gap-3">
            <span className="font-medium text-slate-800">{link.title}</span>
            <span>
              {format(link.contributionTotal)} saved · {link.progress}%
            </span>
          </li>
        ))}
      </RelationshipList>

      <RelationshipList
        title="Recurring ↔ monthly cash flow"
        count={relationships.recurringLinks.length}
        empty="No recurring commitments scheduled yet."
      >
        {relationships.recurringLinks.map((link) => (
          <li key={link.recurringId} className="flex items-center justify-between gap-3">
            <span className="font-medium text-slate-800">{link.label}</span>
            <span>{format(link.monthlyEquivalent)}/month</span>
          </li>
        ))}
      </RelationshipList>
    </div>
  );
}
