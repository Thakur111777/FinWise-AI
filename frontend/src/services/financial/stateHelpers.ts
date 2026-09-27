import type { FinancialCoreState } from './state';

/** Re-exported so services can import the state type alongside the merge helper. */
export type { FinancialCoreState };

/** Immutable-ish update helper: merges only whitelisted keys into a fresh state object. */
export function financialCoreStateWith(
  state: FinancialCoreState,
  patch: Partial<Pick<FinancialCoreState, 'profile' | 'accounts' | 'categories' | 'transactions' | 'budgets' | 'goals' | 'recurringTransactions'>>,
): FinancialCoreState {
  return {
    profile: patch.profile !== undefined ? patch.profile : state.profile,
    accounts: patch.accounts ?? state.accounts,
    categories: patch.categories ?? state.categories,
    transactions: patch.transactions ?? state.transactions,
    budgets: patch.budgets ?? state.budgets,
    goals: patch.goals ?? state.goals,
    recurringTransactions: patch.recurringTransactions ?? state.recurringTransactions,
  };
}