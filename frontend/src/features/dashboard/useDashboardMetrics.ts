import { useMemo } from 'react';
import { computeDashboardMetrics } from '../../intelligence/finance';
import type { DashboardMetrics } from '../../types/financial';
import { useFinancialData } from './useFinancialData';

/**
 * Connects the current financial data state to the Financial Intelligence
 * Engine. The dashboard consumes this hook and only renders what the engine
 * returns — no financial value is ever hardcoded in the UI.
 */
export function useDashboardMetrics(): DashboardMetrics {
  const data = useFinancialData();

  return useMemo(
    () =>
      computeDashboardMetrics({
        accounts: data.accounts,
        transactions: data.transactions,
        budgets: data.budgets,
        goals: data.goals,
        recurringTransactions: data.recurringTransactions,
      }),
    [data],
  );
}