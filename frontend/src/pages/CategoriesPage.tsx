import { useState } from 'react';
import { EyeOff, Eye, Plus, Tags } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Button, Field, Select, TextInput } from '../components/ui/forms';
import { useFinancialData } from '../features/dashboard/useFinancialData';
import type { Category, CategoryType } from '../types/financial';

export function CategoriesPage() {
  const financial = useFinancialData();
  const { actions } = financial;

  const [name, setName] = useState('');
  const [type, setType] = useState<CategoryType>('expense');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const expenseCategories = financial.categories.filter((category) => category.type === 'expense');
  const incomeCategories = financial.categories.filter((category) => category.type === 'income');

  const handleAdd = async () => {
    setError(null);
    setNotice(null);
    try {
      await actions.createCategory({ name, type });
      setName('');
      setNotice(`Added "${name.trim()}" to ${type} categories.`);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Could not add this category.');
    }
  };

  const handleToggleHidden = async (category: Category) => {
    setError(null);
    setNotice(null);
    try {
      await actions.updateCategory(category.id, {
        name: category.name,
        type: category.type,
        isHidden: !category.isHidden,
      });
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Could not update this category.');
    }
  };

  const renderGroup = (title: string, categories: Category[]) => (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      {categories.length === 0 ? (
        <p className="text-sm text-slate-500">No categories yet.</p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
          {categories.map((category) => (
            <li key={category.id} className={`flex items-center justify-between gap-3 px-4 py-3 ${category.isHidden ? 'opacity-60' : ''}`}>
              <div>
                <p className="text-sm font-medium text-slate-900">
                  {category.name}
                  {category.isDefault ? (
                    <span className="ml-2 rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-medium text-teal-700">Default</span>
                  ) : null}
                </p>
                <p className="text-xs text-slate-400">{category.id}</p>
              </div>
              <button
                type="button"
                onClick={() => void handleToggleHidden(category)}
                aria-pressed={category.isHidden}
                aria-label={category.isHidden ? `Show ${category.name} again` : `Hide ${category.name}`}
                className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:text-slate-800"
              >
                {category.isHidden ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
return (
    <div className="space-y-6">
      <header>
        <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Categories</p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">Your spending map</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          Income and expense categories label every transaction. Defaults are seeded when your profile is created; add custom ones freely.
        </p>
      </header>

      {financial.profile === null ? (
        <EmptyState
          icon={Tags}
          title="Set up your profile first"
          description="Default categories are seeded automatically the moment you create your profile in Settings. Custom categories can be added here afterwards."
        />
      ) : (
        <>
          <Card>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Category name" htmlFor="category-name">
                <TextInput id="category-name" value={name} onChange={setName} placeholder="e.g. Pets" />
              </Field>
              <Field label="Type" htmlFor="category-type">
                <Select
                  value={type}
                  onChange={(value: CategoryType) => setType(value)}
                  options={[
                    { value: 'expense', label: 'Expense' },
                    { value: 'income', label: 'Income' },
                  ]}
                />
              </Field>
              <div className="flex items-end">
                <Button variant="primary" onClick={handleAdd} disabled={!name.trim()}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add category
                </Button>
              </div>
            </div>
            {error ? (
              <p role="alert" className="mt-3 text-sm font-medium text-rose-700">{error}</p>
            ) : notice ? (
              <p role="status" className="mt-3 text-sm font-medium text-teal-800">{notice}</p>
            ) : null}
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            {renderGroup('Expense categories', expenseCategories)}
            {renderGroup('Income categories', incomeCategories)}
          </div>

          <p className="text-xs text-slate-500">
            Hiding a category removes it from new-transaction pickers. Categories used by existing transactions cannot be hidden — history always keeps valid references.
          </p>
        </>
      )}
    </div>
  );
}