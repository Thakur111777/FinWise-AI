import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  RotateCcw,
  ArrowLeftRight,
  Eye,
  Pencil,
  Plus,
  Repeat,
  Search,
  Trash2,
  Wallet2,
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Modal } from '../components/ui/Modal';
import { Button, Select, TextInput } from '../components/ui/forms';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useFinancialData } from '../features/dashboard/useFinancialData';
import { TransactionFormModal } from '../features/financial/transactionForm';
import { RecurringFormModal } from '../features/financial/recurringForm';
import { formatCurrency, formatSignedCurrency } from '../lib/currency';
import { formatHumanDate, todayISODate } from '../lib/date';
import { computeUpcomingOccurrences } from '../services/financial/recurringService';
import { filterTransactions, sortTransactions, type TransactionSort } from '../features/financial/transactionQueries';
import {
  getAccountById,
  getCategoryName,
  recurringDisplayName,
  transactionLabel,
} from '../features/financial/selectors';
import type { Transaction, TransactionType } from '../types/financial';
import type { RecurringInput } from '../services/financial/recurringService';
import type { TransactionInput } from '../services/financial/transactionService';

const TYPE_FILTERS: readonly { value: string; label: string }[] = [
  { value: 'all', label: 'All types' },
  { value: 'income', label: 'Income' },
  { value: 'expense', label: 'Expense' },
  { value: 'transfer', label: 'Transfer' },
];

const SORTS: readonly { value: TransactionSort; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'highest', label: 'Highest amount' },
  { value: 'lowest', label: 'Lowest amount' },
];

export function TransactionsPage() {
  const financial = useFinancialData();
  const { actions, accounts, categories, recurringTransactions } = financial;
  const locale = financial.profile?.locale;

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [accountFilter, setAccountFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sort, setSort] = useState<TransactionSort>('newest');

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [viewing, setViewing] = useState<Transaction | null>(null);
  const [deleting, setDeleting] = useState<Transaction | null>(null);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [recurringEditingId, setRecurringEditingId] = useState<string | null>(null);
  const [deletingRecurringId, setDeletingRecurringId] = useState<string | null>(null);

  const activeAccounts = accounts.filter((account) => !account.isArchived);
  const accountOptions = activeAccounts.map((account) => ({ value: account.id, label: `${account.name} (${account.currencyCode})` }));
  const categoryOptions = categories
    .filter((category) => !category.isHidden)
    .map((category) => ({ value: category.id, label: `${category.name} (${category.type})` }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const visibleTypes: TransactionType[] = typeFilter === 'all' ? [] : [typeFilter as TransactionType];

  const filtered = sortTransactions(
    filterTransactions(financial.transactions, {
      types: visibleTypes,
      accountId: accountFilter || undefined,
      categoryId: categoryFilter || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      search: search || undefined,
    }),
    sort,
  );

  const today = todayISODate();
  const upcomingCount = 6;

  const handleSubmitTransaction = async (input: TransactionInput, recurringSchedule?: RecurringInput) => {
    // Development-only diagnostic logging for transaction edit flow
    if (import.meta.env.DEV) {
      console.log('[TransactionsPage] handleSubmitTransaction called');
      console.log('[TransactionsPage] editing:', editing ? { id: editing.id, amount: editing.amount, merchant: editing.merchant } : null);
      console.log('[TransactionsPage] action:', editing ? 'UPDATE' : 'CREATE');
      if (editing) {
        console.log('[TransactionsPage] updating transaction id:', editing.id);
      }
    }

    if (editing) {
      // Editing an existing transaction — update in place, preserving the id.
      await actions.updateTransaction(editing.id, input);
    } else {
      await actions.addTransaction(input, recurringSchedule);
    }

    // Development-only diagnostic logging after save
    if (import.meta.env.DEV) {
      console.log('[TransactionsPage] transaction saved, current transaction count:', financial.transactions.length);
      const txnIds = financial.transactions.map(t => ({ id: t.id, merchant: t.merchant, amount: t.amount }));
      console.log('[TransactionsPage] all transaction ids:', txnIds);
    }
  };

  const handleSubmitRecurring = async (input: RecurringInput) => {
    if (recurringEditingId !== null) {
      await actions.updateRecurring(recurringEditingId, input);
    } else {
      await actions.createRecurring(input);
    }
  };

  const resetFilters = () => {
    setSearch('');
    setTypeFilter('all');
    setAccountFilter('');
    setCategoryFilter('');
    setDateFrom('');
    setDateTo('');
    setSort('newest');
  };

  const hasFilters = search !== '' || typeFilter !== 'all' || accountFilter !== '' || categoryFilter !== '' || dateFrom !== '' || dateTo !== '';

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Transactions</p>
          <h1 className="mt-2 text-3xl font-semibold text-slate-900">Cash-flow timeline</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setRecurringOpen(true)} disabled={activeAccounts.length === 0}>
            <Repeat className="h-4 w-4" aria-hidden="true" />
            Recurring
          </Button>
          <Button variant="primary" onClick={() => setAdding(true)} disabled={activeAccounts.length === 0}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add transaction
          </Button>
        </div>
      </header>

      {activeAccounts.length === 0 ? (
        <EmptyState
          icon={Wallet2}
          title="Create an account to begin"
          description="Transactions are attached to real accounts, and balances update with every income, expense, or transfer. Head to Accounts to create your first one."
        >
          <Link
            to="/accounts"
            className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-teal-800 hover:underline"
          >
            Open Accounts →
          </Link>
        </EmptyState>
      ) : (
        <>
          <Card>
            {/* Row 1: Search + Type + Account + Clear filters */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="relative lg:col-span-1">
                <label htmlFor="txn-search" className="sr-only">Search transactions</label>
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" aria-hidden="true" />
                <TextInput
                  id="txn-search"
                  value={search}
                  onChange={setSearch}
                  placeholder="Search transactions..."
                  className="pl-10"
                />
              </div>

              <div className="lg:col-span-1">
                <label htmlFor="txn-type" className="sr-only">Transaction type</label>
                <Select
                  id="txn-type"
                  value={typeFilter}
                  onChange={setTypeFilter}
                  options={TYPE_FILTERS}
                />
              </div>

              <div className="lg:col-span-1">
                <label htmlFor="txn-account" className="sr-only">Account</label>
                <Select
                  id="txn-account"
                  value={accountFilter}
                  onChange={setAccountFilter}
                  options={accountOptions}
                  placeholder="All accounts"
                />
              </div>

              {hasFilters && (
                <div className="lg:col-span-1">
                  <Button
                    variant="ghost"
                    onClick={resetFilters}
                    className="h-[38px] w-full justify-end gap-2"
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    Clear filters
                  </Button>
                </div>
              )}
            </div>

            {/* Row 2: Category + From + To + Sort */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mt-3">
              <div className="lg:col-span-1">
                <label htmlFor="txn-category" className="sr-only">Category</label>
                <Select
                  id="txn-category"
                  value={categoryFilter}
                  onChange={setCategoryFilter}
                  options={categoryOptions}
                  placeholder="All categories"
                />
              </div>

              <div className="lg:col-span-1">
                <label htmlFor="txn-date-from" className="sr-only">Date from</label>
                <TextInput
                  id="txn-date-from"
                  value={dateFrom}
                  onChange={setDateFrom}
                  type="date"
                />
              </div>

              <div className="lg:col-span-1">
                <label htmlFor="txn-date-to" className="sr-only">Date to</label>
                <TextInput
                  id="txn-date-to"
                  value={dateTo}
                  onChange={setDateTo}
                  type="date"
                />
              </div>

              <div className="lg:col-span-1">
                <label htmlFor="txn-sort" className="sr-only">Sort by</label>
                <Select
                  id="txn-sort"
                  value={sort}
                  onChange={(value) => setSort(value as TransactionSort)}
                  options={SORTS}
                />
              </div>
            </div>
          </Card>

          {filtered.length === 0 ? (
            <EmptyState
              icon={Search}
              title={hasFilters ? 'No results match your filters' : 'No transactions yet'}
              description={
                hasFilters
                  ? 'Try widening the date range, clearing some filters, or searching for something else.'
                  : 'Add your first income, expense, or transfer above. Balances and dashboard metrics update immediately.'
              }
            />
          ) : (
            <Card>
              <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-3 pr-6 font-medium">Date</th>
                      <th className="py-3 pr-6 font-medium">Description</th>
                      <th className="py-3 pr-6 font-medium">Category</th>
                      <th className="py-3 pr-6 font-medium">Account</th>
                      <th className="py-3 pr-2 text-right font-medium">Amount</th>
                      <th className="py-3 text-right font-medium">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((transaction) => {
                      const account = getAccountById(financial, transaction.accountId);
                      const destination = transaction.toAccountId ? getAccountById(financial, transaction.toAccountId) : null;
                      const isIncome = transaction.type === 'income';
                      const isExpense = transaction.type === 'expense';
                      const signed = isIncome ? transaction.amount : -transaction.amount;
                      return (
                        <tr key={transaction.id} className="border-b border-slate-100 last:border-none">
                          <td className="py-3 pr-6 whitespace-nowrap text-slate-600">{formatHumanDate(transaction.date)}</td>
                          <td className="py-3 pr-6 font-medium text-slate-900">
                            {transaction.merchant || transaction.description || transactionLabel(transaction.type)}
                            {transaction.isRecurring ? (
                              <Repeat className="ml-1.5 inline h-3.5 w-3.5 text-slate-400" aria-label="Recurring" />
                            ) : null}
                          </td>
                          <td className="py-3 pr-6 text-slate-600">{getCategoryName(financial, transaction.categoryId)}</td>
                          <td className="py-3 pr-6 text-slate-600">
                            {account?.name ?? 'Unknown account'}
                            {destination ? (
                              <span className="inline-flex items-center gap-1 text-slate-500">
                                <ArrowLeftRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
                                {destination.name}
                              </span>
                            ) : null}
                          </td>
                          <td
                            className={`py-3 pr-2 whitespace-nowrap text-right font-semibold ${
                              isIncome ? 'text-emerald-700' : isExpense ? 'text-slate-900' : 'text-sky-700'
                            }`}
                          >
                            {formatSignedCurrency(signed, transaction.currencyCode, locale)}
                          </td>
                          <td className="py-3 text-right">
                            <div className="flex gap-1">
                              <button type="button" onClick={() => setViewing(transaction)} aria-label="View details" className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:text-slate-800">
                                <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                              <button type="button" onClick={() => {
                                if (import.meta.env.DEV) {
                                  console.log('[TransactionsPage] Edit button clicked for transaction:', { id: transaction.id, merchant: transaction.merchant, amount: transaction.amount });
                                }
                                setEditing(transaction);
                              }} aria-label="Edit transaction" className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:text-slate-800">
                                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                              <button type="button" onClick={() => setDeleting(transaction)} aria-label="Delete transaction" className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:border-rose-200 hover:text-rose-600">
                                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
{recurringTransactions.length > 0 ? (
        <Card>
          <div className="mb-4 flex flex-col gap-1">
            <h2 className="text-lg font-semibold text-slate-900">Recurring transactions</h2>
            <p className="text-xs text-slate-500">
              Upcoming occurrences below are deterministic previews — nothing is auto-created until a backend scheduler exists.
            </p>
          </div>
          <ul className="divide-y divide-slate-200">
            {recurringTransactions.map((item) => {
              const upcoming = computeUpcomingOccurrences(
                { frequency: item.frequency, startDate: item.startDate, endDate: item.endDate },
                today,
                upcomingCount,
              );
              const source = getAccountById(financial, item.accountId);
              const destination = item.toAccountId ? getAccountById(financial, item.toAccountId) : null;
              return (
                <li key={item.id} className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="font-medium text-slate-900">
                      {recurringDisplayName(item.merchant, item.description, item.type)}
                      {item.isActive ? null : (
                        <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">Paused</span>
                      )}
                    </p>
                    <p className="text-sm text-slate-500">
                      {source?.name ?? 'Unknown account'}
                      {destination ? ` → ${destination.name}` : ''}
                      {' · '}
                      {item.frequency}
                      {item.endDate ? ` · until ${formatHumanDate(item.endDate)}` : ''}
                    </p>
                    <p className="text-xs text-slate-400">
                      Next: {upcoming.length > 0 ? upcoming.map(formatHumanDate).join(' · ') : 'No upcoming occurrences'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="whitespace-nowrap text-base font-semibold">
                      {formatSignedCurrency(item.type === 'income' ? item.amount : -item.amount, item.currencyCode, locale)}
                    </p>
                    <button
                      type="button"
                      onClick={() => setRecurringEditingId(item.id)}
                      aria-label="Edit recurring schedule"
                      className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:text-slate-800"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void actions.toggleRecurringActive(item.id, !item.isActive)}
                      aria-label={item.isActive ? 'Pause schedule' : 'Activate schedule'}
                      className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                    >
                      {item.isActive ? 'Pause' : 'Activate'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeletingRecurringId(item.id)}
                      aria-label="Delete recurring schedule"
                      className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:border-rose-200 hover:text-rose-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      <TransactionFormModal
        open={adding || editing !== null}
        state={financial}
        initial={editing}
        title={editing ? 'Edit transaction' : 'Add transaction'}
        onClose={() => {
          setAdding(false);
          setEditing(null);
        }}
        onSubmit={handleSubmitTransaction}
      />

      <RecurringFormModal
        open={recurringOpen || recurringEditingId !== null}
        state={financial}
        initial={
          recurringEditingId !== null
            ? recurringTransactions.find((item) => item.id === recurringEditingId) ?? null
            : null
        }
        onClose={() => {
          setRecurringOpen(false);
          setRecurringEditingId(null);
        }}
        onSubmit={handleSubmitRecurring}
      />

      <ConfirmDialog
        open={deleting !== null}
        title="Delete transaction?"
        message={`This permanently removes "${deleting?.merchant || deleting?.description || 'this transaction'}" (${
          deleting ? formatCurrency(deleting.amount, deleting.currencyCode, locale) : ''
        }) and reverses its effect on the account balance. This cannot be undone.`}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) void actions.deleteTransaction(deleting.id);
          setDeleting(null);
        }}
      />

      <ConfirmDialog
        open={deletingRecurringId !== null}
        title="Delete recurring schedule?"
        message="The schedule and its upcoming occurrences are removed. Transactions already in your history are kept."
        onCancel={() => setDeletingRecurringId(null)}
        onConfirm={() => {
          if (deletingRecurringId) void actions.deleteRecurring(deletingRecurringId);
          setDeletingRecurringId(null);
        }}
      />

      {viewing ? <TransactionDetailModal transaction={viewing} onClose={() => setViewing(null)} /> : null}
    </div>
  );
}
function TransactionDetailModal({ transaction, onClose }: { transaction: Transaction; onClose: () => void }) {
  const financial = useFinancialData();
  const locale = financial.profile?.locale;
  const source = getAccountById(financial, transaction.accountId);
  const destination = transaction.toAccountId ? getAccountById(financial, transaction.toAccountId) : null;
  const category = getCategoryName(financial, transaction.categoryId);

  const rows: [string, string][] = [
    ['Type', transactionLabel(transaction.type)],
    ['Amount', formatCurrency(transaction.amount, transaction.currencyCode, locale)],
    ['Account', source ? `${source.name} (${source.currencyCode})` : 'Unknown account'],
    ...(destination ? [['Destination', `${destination.name} (${destination.currencyCode})`] as [string, string]] : []),
    ['Date', formatHumanDate(transaction.date)],
    ['Category', category],
    ['Merchant', transaction.merchant ?? '—'],
    ['Description', transaction.description ?? '—'],
    ['Notes', transaction.notes ?? '—'],
    ['Recurring', transaction.isRecurring ? 'Yes — linked to a repeating schedule' : 'No'],
  ];

  return (
    <Modal open onClose={onClose} title="Transaction details">
      <dl className="space-y-2.5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 border-b border-slate-100 py-2 last:border-none">
            <dt className="text-sm text-slate-500">{label}</dt>
            <dd className="text-sm font-medium text-slate-900">{value}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-4 py-2">
          <dt className="text-sm text-slate-500">Recorded</dt>
          <dd className="text-xs text-slate-400">{new Date(transaction.createdAt).toLocaleString()}</dd>
        </div>
        {transaction.updatedAt !== transaction.createdAt ? (
          <div className="flex justify-between gap-4 py-2">
            <dt className="text-sm text-slate-500">Last edited</dt>
            <dd className="text-xs text-slate-400">{new Date(transaction.updatedAt).toLocaleString()}</dd>
          </div>
        ) : null}
      </dl>
      <div className="mt-4 flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}