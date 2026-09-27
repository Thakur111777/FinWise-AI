import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { Card } from '../components/ui/Card';
import { countByCollection } from '../intelligence/evidence';
import { isAvailable } from '../intelligence/section';
import type { Evidence, InsufficientDataReason, IntelligenceSection } from '../types/intelligence';
import type { TrendPoint } from '../types/analytics';

/**
 * Shared Analytics section primitives (Phase 4C-5).
 * Every section is either available-with-evidence or insufficient_data;
 * available-with-empty renders "No pattern detected", never "insufficient".
 */
export function SectionCard<T>({
  title,
  subtitle,
  section,
  emptyTitle,
  emptyResultText,
  children,
}: {
  title: string;
  subtitle: string;
  section: IntelligenceSection<T>;
  emptyTitle: string;
  emptyResultText?: string;
  children: ReactNode;
}) {
  const ok = isAvailable(section);
  const isEmptyArray = ok && Array.isArray(section.data) && section.data.length === 0;
  const isEmptyObject =
    ok &&
    !Array.isArray(section.data) &&
    typeof section.data === 'object' &&
    section.data !== null &&
    'transactionCount' in section.data &&
    (section.data as { transactionCount: number }).transactionCount === 0;
  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
      </div>
      {ok ? (
        <>
          {isEmptyArray || isEmptyObject ? (
            <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
              {emptyResultText ?? 'No pattern detected.'}
            </p>
          ) : (
            children
          )}
          <EvidenceLine evidence={section.evidence} />
        </>
      ) : (
        <InsufficientBlock reasons={section.reasons} fallbackTitle={emptyTitle} />
      )}
    </Card>
  );
}

/**
 * Lightweight evidence line: the rule that produced the section, the rule
 * version, how many rows of each collection support it, and a small sample of
 * the actual source pointers. It never invents or reinterprets evidence.
 */
export function EvidenceLine({ evidence }: { evidence: Evidence }) {
  const sources = countByCollection(evidence.sourceRefs);
  const sourceText =
    Object.entries(sources)
      .map(([collection, count]) => `${collection.replace('sources.', '')} ${count}`)
      .join(' · ') || 'no row-level sources';
  const ordered = [...evidence.sourceRefs].sort(
    (a, b) => a.collection.localeCompare(b.collection) || a.id.localeCompare(b.id),
  );
  const samples = ordered.slice(0, 3).map((ref) => `${ref.collection}#${ref.id.slice(0, 8)}`);
  const more = ordered.length - samples.length;
  return (
    <p className="border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-500">
      Evidence: <span className="font-medium text-slate-600">{evidence.ruleId}</span> v
      {evidence.ruleVersion} · from {sourceText}
      {samples.length > 0 && (
        <>
          {' · e.g. '}
          {samples.join(', ')}
          {more > 0 ? ` (+${more} more)` : ''}
        </>
      )}
    </p>
  );
}

export function InsufficientBlock({
  reasons,
  fallbackTitle,
}: {
  reasons: InsufficientDataReason[];
  fallbackTitle: string;
}) {
  if (reasons.length === 0) {
    return <p className="text-sm text-slate-600">{fallbackTitle}</p>;
  }
  const summaryRepeats = reasons.some((reason) => reason.message.trim() === fallbackTitle.trim());
  return (
    <div className="space-y-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
      <p className="text-sm font-medium text-slate-800">Insufficient data</p>
      {fallbackTitle.length > 0 && !summaryRepeats && (
        <p className="text-sm text-slate-600">{fallbackTitle}</p>
      )}
      {reasons.map((reason) => (
        <p key={reason.code} className="text-sm text-slate-600">
          {reason.message}
        </p>
      ))}
    </div>
  );
}

/**
 * Income vs expense periods (Phase 4C-5).
 *
 * Renders exactly what `incomeExpenseTrend` produced: recorded income and
 * recorded expenses per `YYYY-MM` period plus the net difference of those two
 * engine outputs. Periods where one side has no recorded point are shown as "—"
 * and are never zero-filled, and no value is recomputed from raw transactions.
 *
 * A wrapping grid (rather than a `<table>` with a min-width) is used so the
 * section never forces horizontal scrolling on a narrow phone viewport.
 */
export function IncomeExpensePeriods({
  income,
  expenses,
  formatMoney,
  formatSigned,
}: {
  income: TrendPoint[];
  expenses: TrendPoint[];
  formatMoney: (value: number) => string;
  formatSigned: (value: number) => string;
}) {
  const rows = useMemo(() => {
    type Row = { key: string; label: string; income: number | null; expenses: number | null };
    const byPeriod = new Map<string, Row>();
    const upsert = (key: string, label: string): Row => {
      const existing = byPeriod.get(key);
      if (existing) return existing;
      const created: Row = { key, label, income: null, expenses: null };
      byPeriod.set(key, created);
      return created;
    };
    for (const point of income) upsert(point.period.key, point.period.label).income = point.value;
    for (const point of expenses) upsert(point.period.key, point.period.label).expenses = point.value;
    return [...byPeriod.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((row) => ({
        ...row,
        net: row.income !== null && row.expenses !== null ? Math.round((row.income - row.expenses) * 100) / 100 : null,
      }));
  }, [income, expenses]);

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-slate-100">
        {rows.map((row) => (
          <li key={row.key} className="py-3 first:pt-0 last:pb-0">
            <p className="text-sm font-medium text-slate-800">{row.label}</p>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs uppercase tracking-[0.14em] text-slate-500">Income</dt>
                <dd className="mt-0.5 text-slate-700">
                  {row.income === null ? '—' : formatMoney(row.income)}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.14em] text-slate-500">Expenses</dt>
                <dd className="mt-0.5 text-slate-700">
                  {row.expenses === null ? '—' : formatMoney(row.expenses)}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.14em] text-slate-500">Net flow</dt>
                <dd className={`mt-0.5 font-medium ${row.net !== null && row.net < 0 ? 'text-rose-700' : 'text-slate-800'}`}>
                  {row.net === null ? '—' : formatSigned(row.net)}
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
      <p className="text-xs leading-relaxed text-slate-500">
        Net flow is recorded income minus recorded expenses for each period. Periods with no recorded
        income or expense point are shown as — rather than being filled with a zero.
      </p>
    </div>
  );
}

