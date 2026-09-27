import { useState } from 'react';
import { Field, Select, TextInput, Button } from '../components/ui/forms';
import { Modal } from '../components/ui/Modal';
import { useFinancialData } from '../features/dashboard/useFinancialData';
import { SUPPORTED_CURRENCIES } from '../config/currencies';
import { GOAL_STATUSES, type GoalInput } from '../services/financial/goalService';
import type { Goal } from '../types/financial';

const CURRENCY_OPTIONS = SUPPORTED_CURRENCIES.map((currency) => ({
  value: currency.code,
  label: `${currency.symbol} ${currency.code} — ${currency.name}`,
}));

export function GoalFormModal({
  open,
  initial,
  defaultCurrency,
  onClose,
  onSubmit,
}: {
  open: boolean;
  initial: Goal | null;
  defaultCurrency: string;
  onClose: () => void;
  onSubmit: (input: GoalInput) => Promise<void>;
}) {
  const financial = useFinancialData();
  const categories = financial.categories.filter((cat) => !cat.isHidden);
  const [title, setTitle] = useState(initial?.title ?? '');
  const [targetAmount, setTargetAmount] = useState(String(initial?.targetAmount ?? ''));
  const [currentAmount, setCurrentAmount] = useState(String(initial?.currentAmount ?? '0'));
  const [currencyCode, setCurrencyCode] = useState<string>(initial?.currencyCode ?? defaultCurrency);
  const [targetDate, setTargetDate] = useState(initial?.targetDate ?? '');
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '');
  const [status, setStatus] = useState<string>(initial?.status ?? 'active');
  const [formError, setFormError] = useState<string | null>(null);

  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      if (initial) {
        setTitle(initial.title);
        setTargetAmount(String(initial.targetAmount));
        setCurrentAmount(String(initial.currentAmount));
        setCurrencyCode(initial.currencyCode);
        setTargetDate(initial.targetDate ?? '');
        setCategoryId(initial.categoryId ?? '');
        setStatus(initial.status);
      } else {
        setTitle('');
        setTargetAmount('');
        setCurrentAmount('0');
        setCurrencyCode(defaultCurrency);
        setTargetDate('');
        setCategoryId('');
        setStatus('active');
      }
      setFormError(null);
    }
  }

  const handleSubmit = async () => {
    try {
      await onSubmit({
        title,
        targetAmount: Number(targetAmount),
        currentAmount: Number(currentAmount),
        currencyCode: currencyCode as GoalInput['currencyCode'],
        targetDate: targetDate || undefined,
        categoryId: categoryId || undefined,
        status: status as GoalInput['status'],
      });
      setFormError(null);
    } catch (submissionError) {
      setFormError(submissionError instanceof Error ? submissionError.message : 'Could not save this goal.');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={initial ? 'Edit goal' : 'Add goal'}>
      <div className="space-y-4">
        <Field label="Goal name" htmlFor="goal-title">
          <TextInput
            id="goal-title"
            value={title}
            onChange={(value) => setTitle(value)}
            placeholder="e.g. Emergency fund"
            autoComplete="off"
          />
        </Field>
        <Field label="Target amount" htmlFor="goal-target" hint="Total amount you are aiming for.">
          <TextInput
            id="goal-target"
            value={targetAmount}
            onChange={(value) => setTargetAmount(value.replace(/[^\d.,-]/g, ''))}
            autoComplete="off"
          />
        </Field>
        <Field label="Current saved amount" htmlFor="goal-current" hint="Amount already saved toward this goal.">
          <TextInput
            id="goal-current"
            value={currentAmount}
            onChange={(value) => setCurrentAmount(value.replace(/[^\d.,-]/g, ''))}
            autoComplete="off"
          />
        </Field>
        <Field label="Currency" htmlFor="goal-currency">
          <Select value={currencyCode} onChange={(value) => setCurrencyCode(value)} options={CURRENCY_OPTIONS} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Target date (optional)" htmlFor="goal-date" hint="YYYY-MM-DD">
            <TextInput
              id="goal-date"
              value={targetDate}
              onChange={(value) => setTargetDate(value)}
              autoComplete="off"
            />
          </Field>
          <Field label="Status" htmlFor="goal-status">
            <Select value={status} onChange={(value) => setStatus(value)} options={GOAL_STATUSES} />
          </Field>
        </div>
        <Field label="Category (optional)" htmlFor="goal-category">
          <Select
            value={categoryId}
            onChange={(value) => setCategoryId(value)}
            options={[{ value: '', label: 'None' }, ...categories.map((cat) => ({ value: cat.id, label: cat.name }))]}
          />
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
          <Button variant="primary" onClick={handleSubmit} disabled={!title || !targetAmount || !currentAmount}>
            {initial ? 'Save changes' : 'Create goal'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}