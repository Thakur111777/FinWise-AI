import { useState } from 'react';
import { todayISODate } from '../../lib/date';
import { Button, Field, Select, TextInput, ToggleCheckbox } from '../../components/ui/forms';
import { Modal } from '../../components/ui/Modal';
import { categoriesForType } from './selectors';
import type { FinancialCoreState } from '../../services/financial/state';
import type { TransactionInput } from '../../services/financial/transactionService';
import type { CurrencyCode, RecurrenceFrequency, Transaction, TransactionType } from '../../types/financial';

const FREQUENCIES: readonly { value: RecurrenceFrequency; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

const TYPE_OPTIONS: readonly { value: TransactionType; label: string }[] = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Transfer' },
];

interface RecurringScheduleInput {
  accountId: string;
  toAccountId?: string | null;
  type: TransactionType;
  amount: number;
  currencyCode: CurrencyCode;
  categoryId?: string | null;
  merchant?: string | null;
  description?: string | null;
  frequency: RecurrenceFrequency;
  startDate: string;
  endDate?: string | null;
}

export interface TransactionFormModalProps {
  open: boolean;
  state: FinancialCoreState;
  initial?: Transaction | null;
  title: string;
  onClose: () => void;
  onSubmit: (input: TransactionInput, recurringSchedule?: RecurringScheduleInput) => Promise<void>;
}

interface FormState {
  type: TransactionType;
  accountId: string;
  toAccountId: string;
  amount: string;
  categoryId: string;
  date: string;
  merchant: string;
  description: string;
  notes: string;
  isRecurring: boolean;
  frequency: RecurrenceFrequency;
  startDate: string;
  endDate: string;
}

function emptyForm(firstAccountId: string): FormState {
  const today = todayISODate();
  return {
    type: 'expense',
    accountId: firstAccountId,
    toAccountId: '',
    amount: '',
    categoryId: '',
    date: today,
    merchant: '',
    description: '',
    notes: '',
    isRecurring: false,
    frequency: 'monthly',
    startDate: today,
    endDate: '',
  };
}

export function TransactionFormModal({ open, state, initial, title, onClose, onSubmit }: TransactionFormModalProps) {
  const activeAccounts = state.accounts.filter((account) => !account.isArchived);
  const firstAccountId = activeAccounts[0]?.id ?? '';
  const [form, setFormState] = useState<FormState>(() => emptyForm(firstAccountId));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset the form whenever the modal opens (React's documented
  // "adjust state when a prop changes" pattern — no effect needed).
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setError(null);
      setSubmitting(false);
      if (initial) {
        setFormState({
          type: initial.type,
          accountId: initial.accountId,
          toAccountId: initial.toAccountId ?? '',
          amount: String(initial.amount),
          categoryId: initial.categoryId ?? '',
          date: initial.date,
          merchant: initial.merchant ?? '',
          description: initial.description ?? '',
          notes: initial.notes ?? '',
          isRecurring: false,
          frequency: 'monthly',
          startDate: initial.date,
          endDate: '',
        });
      } else {
        setFormState(emptyForm(firstAccountId));
      }
    }
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setFormState((current) => ({ ...current, [key]: value }));
  };

  const selectedAccount = activeAccounts.find((account) => account.id === form.accountId);
  const currencyOfAccount = selectedAccount?.currencyCode ?? 'INR';
  const categoryType = form.type === 'income' ? 'income' : 'expense';
  const categoryOptions = categoriesForType(state, categoryType).map((category) => ({ value: category.id, label: category.name }));
  const accountOptions = activeAccounts.map((account) => ({ value: account.id, label: `${account.name} (${account.currencyCode})` }));
  const transferTargets = activeAccounts.filter((account) => account.id !== form.accountId);

  const handleSubmit = async () => {
    setError(null);
    const amount = Number(form.amount);
    if (Number.isNaN(amount) || amount <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }
    setSubmitting(true);
    try {
      const base = {
        accountId: form.accountId,
        toAccountId: form.type === 'transfer' ? form.toAccountId : undefined,
        type: form.type,
        amount,
        currencyCode: currencyOfAccount,
        categoryId: form.type === 'transfer' ? undefined : (form.categoryId || undefined),
        merchant: form.merchant || undefined,
        description: form.description || undefined,
        notes: form.notes || undefined,
      };
      const recurringSchedule = form.isRecurring
        ? {
            ...base,
            frequency: form.frequency,
            startDate: form.startDate,
            endDate: form.endDate || undefined,
          }
        : undefined;
      const input: TransactionInput = { ...base, date: form.date, isRecurring: form.isRecurring };
      await onSubmit(input, recurringSchedule);
      onClose();
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Could not save this transaction.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={title} wide>
      <div className="space-y-4">
        <Field label="Type" htmlFor="txn-type">
          <div id="txn-type" className="flex gap-2">
            {TYPE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => set('type', option.value)}
                aria-pressed={form.type === option.value}
                className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium ${
                  form.type === option.value
                    ? 'border-teal-700 bg-teal-50 text-teal-900'
                    : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Account (from)" htmlFor="txn-account">
            <Select
              value={form.accountId}
              onChange={(value: string) => {
                if (form.toAccountId === value) set('toAccountId', '');
                set('accountId', value);
              }}
              options={accountOptions}
              placeholder="Select account"
            />
          </Field>
          {form.type === 'transfer' ? (
            <Field label="Destination account" htmlFor="txn-to-account">
              <Select
                value={form.toAccountId}
                onChange={(value: string) => set('toAccountId', value)}
                options={transferTargets.map((account) => ({ value: account.id, label: `${account.name} (${account.currencyCode})` }))}
                placeholder="Select destination"
              />
            </Field>
          ) : null}
          <Field label="Amount" htmlFor="txn-amount" hint={`Currency: ${currencyOfAccount}`}>
            <TextInput
              id="txn-amount"
              value={form.amount}
              onChange={(value) => set('amount', value.replace(/[^\d.,-]/g, ''))}
              placeholder="0.00"
              autoComplete="off"
            />
          </Field>
          <Field label="Date" htmlFor="txn-date">
            <TextInput id="txn-date" value={form.date} onChange={(value) => set('date', value)} type="date" />
          </Field>
          {form.type === 'transfer' ? null : (
            <Field label={form.type === 'income' ? 'Income category' : 'Category'} htmlFor="txn-category">
              <Select
                value={form.categoryId}
                onChange={(value: string) => set('categoryId', value)}
                options={categoryOptions}
                placeholder="Select category"
              />
            </Field>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Merchant / payee" htmlFor="txn-merchant">
            <TextInput id="txn-merchant" value={form.merchant} onChange={(value) => set('merchant', value)} placeholder="e.g. Café" />
          </Field>
          <Field label="Description" htmlFor="txn-description">
            <TextInput id="txn-description" value={form.description} onChange={(value) => set('description', value)} placeholder="Optional note for your timeline" />
          </Field>
        </div>
<Field label="Notes" htmlFor="txn-notes">
          <textarea
            id="txn-notes"
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
            rows={2}
            value={form.notes}
            placeholder="Anything worth remembering about this transaction"
            onChange={(event) => set('notes', event.target.value)}
          />
        </Field>

        <ToggleCheckbox
          label="Make this a recurring transaction"
          description="Registers a repeating schedule. Upcoming occurrences are previewed on the Transactions page — nothing is created automatically."
          checked={form.isRecurring}
          onChange={(checked) => set('isRecurring', checked)}
        />

        {form.isRecurring ? (
          <div className="rounded-xl border border-teal-100 bg-teal-50 p-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Frequency" htmlFor="txn-frequency">
                <Select value={form.frequency} onChange={(value: RecurrenceFrequency) => set('frequency', value)} options={FREQUENCIES} />
              </Field>
              <Field label="Starts on" htmlFor="txn-start">
                <TextInput id="txn-start" value={form.startDate} onChange={(value) => set('startDate', value)} type="date" />
              </Field>
              <Field label="Ends on (optional)" htmlFor="txn-end">
                <TextInput id="txn-end" value={form.endDate} onChange={(value) => set('endDate', value)} type="date" />
              </Field>
            </div>
          </div>
        ) : null}

        {error ? (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-700">
            {error}
          </div>
        ) : null}

        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Saving…' : 'Save transaction'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}