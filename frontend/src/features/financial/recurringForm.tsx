import { useState } from 'react';
import { todayISODate } from '../../lib/date';
import { Button, Field, Select, TextInput, ToggleCheckbox } from '../../components/ui/forms';
import { Modal } from '../../components/ui/Modal';
import { categoriesForType } from './selectors';
import type { FinancialCoreState } from '../../services/financial/state';
import type { RecurringInput } from '../../services/financial/recurringService';
import type { RecurrenceFrequency, RecurringTransaction, TransactionType } from '../../types/financial';

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

interface RecurringFormProps {
  open: boolean;
  state: FinancialCoreState;
  initial?: RecurringTransaction | null;
  onClose: () => void;
  onSubmit: (input: RecurringInput) => Promise<void>;
}

export function RecurringFormModal({ open, state, initial, onClose, onSubmit }: RecurringFormProps) {
  const activeAccounts = state.accounts.filter((account) => !account.isArchived);
  const [type, setType] = useState<TransactionType>('expense');
  const [accountId, setAccountId] = useState(activeAccounts[0]?.id ?? '');
  const [toAccountId, setToAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [merchant, setMerchant] = useState('');
  const [description, setDescription] = useState('');
  const [frequency, setFrequency] = useState<RecurrenceFrequency>('monthly');
  const [startDate, setStartDate] = useState(todayISODate());
  const [endDate, setEndDate] = useState('');
  const [isActive, setIsActive] = useState(true);
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
        setType(initial.type);
        setAccountId(initial.accountId);
        setToAccountId(initial.toAccountId ?? '');
        setAmount(String(initial.amount));
        setCategoryId(initial.categoryId ?? '');
        setMerchant(initial.merchant ?? '');
        setDescription(initial.description ?? '');
        setFrequency(initial.frequency);
        setStartDate(initial.startDate);
        setEndDate(initial.endDate ?? '');
        setIsActive(initial.isActive);
      } else {
        setType('expense');
        setAccountId(activeAccounts[0]?.id ?? '');
        setToAccountId('');
        setAmount('');
        setCategoryId('');
        setMerchant('');
        setDescription('');
        setFrequency('monthly');
        setStartDate(todayISODate());
        setEndDate('');
        setIsActive(true);
      }
    }
  }

  const selectedAccount = activeAccounts.find((account) => account.id === accountId);
  const currencyOfAccount = selectedAccount?.currencyCode ?? 'INR';
  const categoryOptions = categoriesForType(state, type === 'income' ? 'income' : 'expense').map((category) => ({
    value: category.id,
    label: category.name,
  }));
  const accountOptions = activeAccounts.map((account) => ({ value: account.id, label: `${account.name} (${account.currencyCode})` }));
  const transferTargets = activeAccounts.filter((account) => account.id !== accountId);

  const handleSubmit = async () => {
    setError(null);
    const numericAmount = Number(amount);
    if (Number.isNaN(numericAmount) || numericAmount <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }
    if (!accountId) {
      setError('Choose an account.');
      return;
    }
    setSubmitting(true);
    try {
      const input: RecurringInput = {
        accountId,
        toAccountId: type === 'transfer' ? toAccountId : undefined,
        type,
        amount: numericAmount,
        currencyCode: currencyOfAccount,
        categoryId: type === 'transfer' ? undefined : (categoryId || undefined),
        merchant: merchant || undefined,
        description: description || undefined,
        frequency,
        startDate,
        endDate: endDate || undefined,
        isActive,
      };
      await onSubmit(input);
      onClose();
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Could not save this schedule.');
    } finally {
      setSubmitting(false);
    }
  };
return (
    <Modal open={open} onClose={onClose} title={initial ? 'Edit recurring transaction' : 'Add recurring transaction'} wide>
      <div className="space-y-4">
        <Field label="Type">
          <div className="flex gap-2">
            {TYPE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setType(option.value)}
                aria-pressed={type === option.value}
                className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium ${
                  type === option.value
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
          <Field label="Account (from)">
            <Select
              value={accountId}
              onChange={(value: string) => {
                if (toAccountId === value) setToAccountId('');
                setAccountId(value);
              }}
              options={accountOptions}
              placeholder="Select account"
            />
          </Field>
          {type === 'transfer' ? (
            <Field label="Destination account">
              <Select
                value={toAccountId}
                onChange={(value: string) => setToAccountId(value)}
                options={transferTargets.map((account) => ({ value: account.id, label: `${account.name} (${account.currencyCode})` }))}
                placeholder="Select destination"
              />
            </Field>
          ) : null}
          <Field label="Amount" hint={`Currency: ${currencyOfAccount}`}>
            <TextInput value={amount} onChange={(value) => setAmount(value.replace(/[^\d.,-]/g, ''))} placeholder="0.00" autoComplete="off" />
          </Field>
          {type === 'transfer' ? null : (
            <Field label={type === 'income' ? 'Income category' : 'Category'}>
              <Select value={categoryId} onChange={(value: string) => setCategoryId(value)} options={categoryOptions} placeholder="Select category" />
            </Field>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Merchant / payee">
            <TextInput value={merchant} onChange={setMerchant} placeholder="e.g. Rent" />
          </Field>
          <Field label="Description">
            <TextInput value={description} onChange={setDescription} placeholder="Optional summary" />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Frequency">
            <Select value={frequency} onChange={(value: RecurrenceFrequency) => setFrequency(value)} options={FREQUENCIES} />
          </Field>
          <Field label="Starts on">
            <TextInput value={startDate} onChange={setStartDate} type="date" />
          </Field>
          <Field label="Ends on (optional)">
            <TextInput value={endDate} onChange={setEndDate} type="date" />
          </Field>
        </div>

        <ToggleCheckbox
          label="Schedule is active"
          description="Inactive schedules are kept but no longer counted in forecasts."
          checked={isActive}
          onChange={setIsActive}
        />

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
            {submitting ? 'Saving…' : 'Save schedule'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}