import { useState } from 'react';
import { Landmark, Pencil, Plus, Trash2 } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Button } from '../components/ui/forms';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useFinancialData } from '../features/dashboard/useFinancialData';
import { defaultCurrency, getCategoryById } from '../features/financial/selectors';
import { formatCurrency } from '../lib/currency';
import { budgetPeriodLabel, budgetSpentFor, type BudgetInput } from '../services/financial/budgetService';
import { BudgetFormModal } from './BudgetFormModal';
import type { Budget } from '../types/financial';

export function BudgetPage() {
  const financial = useFinancialData();
  const { budgets, actions, transactions } = financial;
  const currencyCode = defaultCurrency(financial);
  const locale = financial.profile?.locale;

  const derivedBudgets = budgets.map((budget) => ({
    ...budget,
    spent: budgetSpentFor(budget, transactions),
  }));

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Budget | null>(null);
  const [deleting, setDeleting] = useState<Budget | null>(null);

  const handleSubmit = async (input: BudgetInput) => {
    if (editing) {
      await actions.updateBudget(editing.id, input);
      setEditing(null);
    } else {
      await actions.createBudget(input);
      setCreating(false);
    }
  };

  const renderBudget = (budget: Budget) => {
    const category = getCategoryById(financial, budget.categoryId);
    const categoryName = category?.name ?? budget.categoryId;
    const used = budget.limit > 0 ? Math.round((budget.spent / budget.limit) * 100) : 0;

    return (
      <Card key={budget.id}>
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-900">{categoryName}</h2>
            <p className="text-sm text-slate-500">
              {budgetPeriodLabel(budget.period)} · {budget.startDate} to {budget.endDate}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-500">
              {formatCurrency(budget.spent, currencyCode, locale)} / {formatCurrency(budget.limit, currencyCode, locale)}
            </span>
            <button
              type="button"
              onClick={() => setEditing(budget)}
              aria-label={`Edit ${categoryName} budget`}
              className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:text-slate-800"
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setDeleting(budget)}
              aria-label={`Delete ${categoryName} budget`}
              className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:text-rose-600"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="mt-4 h-2.5 rounded-full bg-slate-200">
          <div
            className="h-2.5 rounded-full bg-teal-600"
            style={{ width: `${Math.min(100, used)}%` }}
          />
        </div>
        <p className="mt-3 text-sm text-slate-600">{used}% of planned budget used.</p>
      </Card>
    );
  };

  // Confirmations read like the user's own data (category name), never a raw id.
  const deletingCategoryName = deleting
    ? getCategoryById(financial, deleting.categoryId)?.name ?? deleting.categoryId
    : 'this category';

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Budget</p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">Monthly allocation plan</h1>
      </header>

      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {budgets.length} budget{budgets.length !== 1 ? 's' : ''} defined
        </p>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add budget
        </Button>
      </div>

      {budgets.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title="No budgets yet"
          description="Monthly allocation plans appear here once budgets are defined from your real income and spending data."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {derivedBudgets.map(renderBudget)}
        </div>
      )}

      <BudgetFormModal
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
        open={deleting !== null}
        title="Delete budget?"
        message={`This budget for "${deletingCategoryName}" will be permanently removed. This does not delete any transactions.`}
        confirmLabel="Delete"
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) {
            void actions.deleteBudget(deleting.id);
          }
          setDeleting(null);
        }}
      />
    </div>
  );
}