import { useState } from 'react';
import { ArchiveRestore, Banknote, Pencil, Plus, Trash2, WalletCards } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Button, Field, Select, TextInput } from '../components/ui/forms';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useFinancialData } from '../features/dashboard/useFinancialData';
import { formatCurrency } from '../lib/currency';
import { totalAccountBalance } from '../intelligence/finance';
import { ACCOUNT_TYPES, accountTypeLabel, type AccountInput } from '../services/financial/accountService';
import { SUPPORTED_CURRENCIES } from '../config/currencies';
import { accountBalanceById } from '../features/financial/selectors';
import type { Account, AccountType, CurrencyCode } from '../types/financial';

const CURRENCY_OPTIONS = SUPPORTED_CURRENCIES.map((currency) => ({
  value: currency.code,
  label: `${currency.symbol} ${currency.code} — ${currency.name}`,
}));

export function AccountsPage() {
  const financial = useFinancialData();
  const { actions } = financial;
  const currencyCode = financial.profile?.primaryCurrency ?? 'INR';
  const locale = financial.profile?.locale;

  const active = financial.accounts.filter((account) => !account.isArchived);
  const archived = financial.accounts.filter((account) => account.isArchived);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [archiving, setArchiving] = useState<Account | null>(null);
  const [deleting, setDeleting] = useState<Account | null>(null);

  const handleSubmit = async (input: AccountInput) => {
    if (editing) {
      await actions.updateAccount(editing.id, input);
      setEditing(null);
    } else {
      await actions.createAccount(input);
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (deleting) {
      await actions.deleteAccount(deleting.id);
      setDeleting(null);
    }
  };

  const renderAccount = (account: Account, isArchived: boolean) => (
    <div
      key={account.id}
      className={`flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between ${
        isArchived ? 'border-slate-200 bg-slate-50' : 'border-slate-200 bg-white shadow-soft'
      }`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="truncate text-lg font-semibold text-slate-900">{account.name}</h2>
          {isArchived ? (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Archived</span>
          ) : null}
        </div>
        <p className="text-sm text-slate-500">
          {accountTypeLabel(account.type)}
          {account.institutionName ? ` · ${account.institutionName}` : ''}
          {' · '}
          {account.currencyCode}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <p className="text-xl font-semibold text-slate-900">
          {formatCurrency(accountBalanceById(financial, account.id), account.currencyCode, locale)}
        </p>
        <button
          type="button"
          onClick={() => setEditing(account)}
          aria-label={`Edit ${account.name}`}
          className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:text-slate-800"
        >
          <Pencil className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => setArchiving(account)}
          aria-label={isArchived ? `Restore ${account.name}` : `Archive ${account.name}`}
          className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:text-slate-800"
        >
          <ArchiveRestore className="h-4 w-4" aria-hidden="true" />
        </button>
        {isArchived && (
          <button
            type="button"
            onClick={() => setDeleting(account)}
            aria-label={`Delete ${account.name}`}
            className="rounded-lg border border-rose-300 bg-rose-50 p-1.5 text-rose-600 hover:bg-rose-100"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Accounts</p>
          <h1 className="mt-2 text-3xl font-semibold text-slate-900">Where your money lives</h1>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add account
        </Button>
      </header>

      <Card>
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Total balance (active accounts)</p>
          <p className="text-2xl font-semibold text-slate-900">{formatCurrency(totalAccountBalance(active), currencyCode, locale)}</p>
        </div>
      </Card>

      {financial.accounts.length === 0 ? (
        <EmptyState
          icon={WalletCards}
          title="No accounts yet"
          description="Create an account (cash, checking, savings, credit card, investment, or other) with its opening balance. Balances always compute from real transactions — never fabricated."
        />
      ) : (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">Active accounts</h2>
          {active.length === 0 ? (
            <EmptyState icon={Banknote} title="Nothing active" description="Archived accounts are hidden from new transactions and active balances." />
          ) : (
            active.map((account) => renderAccount(account, false))
          )}

          {archived.length > 0 ? (
            <>
              <h2 className="pt-2 text-lg font-semibold text-slate-900">Archived</h2>
              {archived.map((account) => renderAccount(account, true))}
              <p className="text-xs text-slate-500">
                Archived accounts keep their transaction history for reporting; balances no longer count toward totals or new transactions.
              </p>
            </>
          ) : null}
        </section>
      )}

      <AccountFormModal
        open={creating || editing !== null}
        initial={editing}
        defaultCurrency={currencyCode}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSubmit={handleSubmit}
      />

      <ConfirmDialog
        open={archiving !== null}
        title={archiving?.isArchived ? 'Restore account?' : 'Archive account?'}
        message={
          archiving?.isArchived
            ? `${archiving.name} becomes active again and counts toward totals and new transactions.`
            : `${archiving?.name ?? 'This account'} is hidden from active balances and new transactions. Its full transaction history is kept for reporting. An account can only be archived — deleting is blocked while it has transactions.`
        }
        confirmLabel={archiving?.isArchived ? 'Restore' : 'Archive'}
        onCancel={() => setArchiving(null)}
        onConfirm={() => {
          if (archiving?.isArchived) {
            void actions.unarchiveAccount(archiving.id);
          } else if (archiving) {
            void actions.archiveAccount(archiving.id);
          }
          setArchiving(null);
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        title="Permanently delete account?"
        message={
          deleting
            ? `This permanently removes "${deleting.name}" and all its data. This cannot be undone. The account must be archived before it can be deleted, and it cannot be deleted if it has any transactions linked to it.`
            : ''
        }
        confirmLabel="Delete permanently"
        onCancel={() => setDeleting(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
function AccountFormModal({
  open,
  initial,
  defaultCurrency,
  onClose,
  onSubmit,
}: {
  open: boolean;
  initial: Account | null;
  defaultCurrency: CurrencyCode;
  onClose: () => void;
  onSubmit: (input: AccountInput) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('checking');
  const [currencyCode, setCurrencyCode] = useState<CurrencyCode>(defaultCurrency);
  const [initialBalance, setInitialBalance] = useState('0');
  const [institutionName, setInstitutionName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  // Reset the form whenever the dialog opens (React's documented
  // "adjust state when a prop changes" pattern — no effect needed).
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      if (initial) {
        setName(initial.name);
        setType(initial.type);
        setCurrencyCode(initial.currencyCode);
        setInitialBalance(String(initial.initialBalance));
        setInstitutionName(initial.institutionName ?? '');
      } else {
        setName('');
        setType('checking');
        setCurrencyCode(defaultCurrency);
        setInitialBalance('0');
        setInstitutionName('');
      }
      setFormError(null);
    }
  }

  const handleSubmit = async () => {
    const numericBalance = Number(initialBalance);
    try {
      await onSubmit({
        name,
        type,
        currencyCode,
        initialBalance: Number.isNaN(numericBalance) ? undefined : numericBalance,
        institutionName: institutionName || undefined,
      });
      setFormError(null);
    } catch (submissionError) {
      setFormError(submissionError instanceof Error ? submissionError.message : 'Could not save this account.');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={initial ? 'Edit account' : 'Add account'}>
      <div className="space-y-4">
        <Field label="Account name" htmlFor="acct-name">
          <TextInput id="acct-name" value={name} onChange={setName} placeholder="e.g. HDFC Savings" />
        </Field>
        <Field label="Account type" htmlFor="acct-type">
          <Select<AccountType> value={type} onChange={(value) => setType(value)} options={ACCOUNT_TYPES} />
        </Field>
        <Field label="Currency" htmlFor="acct-currency">
          <Select<CurrencyCode> value={currencyCode} onChange={(value) => setCurrencyCode(value)} options={CURRENCY_OPTIONS} />
        </Field>
        <Field label="Opening balance" htmlFor="acct-balance" hint="Your current balance in this account today. It grows and shrinks with transactions.">
          <TextInput id="acct-balance" value={initialBalance} onChange={(value) => setInitialBalance(value.replace(/[^\d.,-]/g, ''))} autoComplete="off" />
        </Field>
        <Field label="Institution (optional)" htmlFor="acct-institution">
          <TextInput id="acct-institution" value={institutionName} onChange={setInstitutionName} placeholder="e.g. State Bank of India" />
        </Field>

        {formError ? (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-700">
            {formError}
          </div>
        ) : null}

        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={!name.trim()}>
            {initial ? 'Save changes' : 'Create account'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}