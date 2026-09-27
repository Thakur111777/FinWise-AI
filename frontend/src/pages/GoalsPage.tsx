import { useState } from 'react';
import { PiggyBank, Pencil, Plus, Trash2 } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Button } from '../components/ui/forms';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useFinancialData } from '../features/dashboard/useFinancialData';
import { defaultCurrency, getCategoryName } from '../features/financial/selectors';
import { formatCurrency } from '../lib/currency';
import { goalStatusLabel, type GoalInput } from '../services/financial/goalService';
import { goalProgress } from '../intelligence/finance';
import { GoalFormModal } from './GoalFormModal';
import type { Goal } from '../types/financial';

export function GoalsPage() {
  const financial = useFinancialData();
  const { goals, actions } = financial;
  const currencyCode = defaultCurrency(financial);
  const locale = financial.profile?.locale;

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Goal | null>(null);
  const [deleting, setDeleting] = useState<Goal | null>(null);

  const handleSubmit = async (input: GoalInput) => {
    if (editing) {
      await actions.updateGoal(editing.id, input);
      setEditing(null);
    } else {
      await actions.createGoal(input);
      setCreating(false);
    }
  };

  const renderGoal = (goal: Goal) => {
    const progress = goalProgress(goal);
    const categoryName = goal.categoryId ? getCategoryName(financial, goal.categoryId) : null;

    return (
      <Card key={goal.id}>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-slate-900">{goal.title}</h2>
              <span className="text-xs text-slate-500 uppercase tracking-wide">{goal.status}</span>
            </div>
            <p className="text-sm text-slate-500">
              {goal.targetDate
                ? `Target date: ${new Date(goal.targetDate).toLocaleDateString()} · `
                : ''}
              {categoryName ? `Category: ${categoryName} · ` : ''}
              Status: {goalStatusLabel(goal.status)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xl font-semibold text-slate-900">{formatCurrency(goal.currentAmount, currencyCode, locale)}</p>
            <p className="text-sm text-slate-500">of {formatCurrency(goal.targetAmount, currencyCode, locale)}</p>
          </div>
        </div>
        <div className="mt-4 h-2.5 rounded-full bg-slate-200">
          <div className="h-2.5 rounded-full bg-teal-700" style={{ width: `${progress}%` }} />
        </div>
        <p className="mt-3 text-sm text-slate-600">
          {progress}% complete — computed from saved amount divided by target.
        </p>
        <div className="flex justify-end gap-2 mt-2">
          <button
            type="button"
            onClick={() => setEditing(goal)}
            aria-label={`Edit ${goal.title}`}
            className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:text-slate-800"
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setDeleting(goal)}
            aria-label={`Delete ${goal.title}`}
            className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:text-rose-600"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Goals</p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">Adaptive goal tracking</h1>
      </header>

      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {goals.length} goal{goals.length !== 1 ? 's' : ''} defined
        </p>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add goal
        </Button>
      </div>

      {goals.length === 0 ? (
        <EmptyState
          icon={PiggyBank}
          title="No goals yet"
          description="Adaptive goal tracking appears here once you create goals. Progress is always calculated from the goal target and your real saved amount."
        />
      ) : (
        <div className="space-y-4">
          {goals.map(renderGoal)}
        </div>
      )}

      <GoalFormModal
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
        title="Delete goal?"
        message={`This goal "${deleting?.title ?? ''}" will be permanently removed.`}
        confirmLabel="Delete"
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) {
            void actions.deleteGoal(deleting.id);
          }
          setDeleting(null);
        }}
      />
    </div>
  );
}