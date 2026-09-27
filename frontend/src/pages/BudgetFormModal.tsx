import { useState } from 'react';
import { Field, Select, TextInput, Button } from '../components/ui/forms';
import { Modal } from '../components/ui/Modal';
import { useFinancialData } from '../features/dashboard/useFinancialData';
import { SUPPORTED_CURRENCIES } from '../config/currencies';
import { BUDGET_PERIODS, type BudgetInput } from '../services/financial/budgetService';
import type { Budget } from '../types/financial';

const CURRENCY_OPTIONS = SUPPORTED_CURRENCIES.map((currency) => ({
  value: currency.code,
  label: `${currency.symbol} ${currency.code} — ${currency.name}`,
}));

export function BudgetFormModal({
  open,
  initial,
  defaultCurrency,
  onClose,
  onSubmit,
}: {
  open: boolean;
  initial: Budget | null;
  defaultCurrency: string;
  onClose: () => void;
  onSubmit: (input: BudgetInput) => Promise<void>;
}) {
  const financial = useFinancialData();
  const expenseCategories = financial.categories.filter(
    (cat) => cat.type === 'expense' && !cat.isHidden
  );
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '');
  const [currencyCode, setCurrencyCode] = useState<string>(initial?.currencyCode ?? defaultCurrency);
  const [limit, setLimit] = useState(String(initial?.limit ?? ''));
  const [period, setPeriod] = useState<string>(initial?.period ?? 'monthly');
  const [startDate, setStartDate] = useState(initial?.startDate ?? '');
  const [endDate, setEndDate] = useState(initial?.endDate ?? '');
  const [formError, setFormError] = useState<string | null>(null);

  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      if (initial) {
        setCategoryId(initial.categoryId);
        setCurrencyCode(initial.currencyCode);
        setLimit(String(initial.limit));
        setPeriod(initial.period);
        setStartDate(initial.startDate);
        setEndDate(initial.endDate);
      } else {
        setCategoryId('');
        setCurrencyCode(defaultCurrency);
        setLimit('');
        setPeriod('monthly');
        const today = new Date();
        const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const lastOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        setStartDate(firstOfMonth.toISOString().split('T')[0]);
        setEndDate(lastOfMonth.toISOString().split('T')[0]);
      }
      setFormError(null);
    }
  }

  const handleSubmit = async () => {
    try {
      await onSubmit({
        categoryId,
        currencyCode: currencyCode as BudgetInput['currencyCode'],
        limit: Number(limit),
        period: period as BudgetInput['period'],
        startDate,
        endDate,
      });
      setFormError(null);
    } catch (submissionError) {
      setFormError(submissionError instanceof Error ? submissionError.message : 'Could not save this budget.');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={initial ? 'Edit budget' : 'Add budget'}>
      <div className="space-y-4">
        <Field label="Category" htmlFor="budget-category" hint="Budgets apply to expense categories only.">
          <Select
            value={categoryId}
            onChange={(value) => setCategoryId(value)}
            options={expenseCategories.map((cat) => ({ value: cat.id, label: cat.name }))}
          />
        </Field>
        <Field label="Currency" htmlFor="budget-currency">
          <Select value={currencyCode} onChange={(value) => setCurrencyCode(value)} options={CURRENCY_OPTIONS} />
        </Field>
        <Field label="Budget limit" htmlFor="budget-limit" hint="Planned spending limit for this period.">
          <TextInput
            id="budget-limit"
            value={limit}
            onChange={(value) => setLimit(value.replace(/[^\d.,-]/g, ''))}
            autoComplete="off"
          />
        </Field>
        <Field label="Period" htmlFor="budget-period">
          <Select value={period} onChange={(value) => setPeriod(value)} options={BUDGET_PERIODS} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Start date" htmlFor="budget-start" hint="YYYY-MM-DD">
            <TextInput
              id="budget-start"
              value={startDate}
              onChange={(value) => setStartDate(value)}
              autoComplete="off"
            />
          </Field>
          <Field label="End date" htmlFor="budget-end" hint="YYYY-MM-DD">
            <TextInput
              id="budget-end"
              value={endDate}
              onChange={(value) => setEndDate(value)}
              autoComplete="off"
            />
          </Field>
        </div>

        {formError ? (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-700">
            {formError}
          </div>
        ) : null}

        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={!categoryId || !limit || !startDate || !endDate}>
            {initial ? 'Save changes' : 'Create budget'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}