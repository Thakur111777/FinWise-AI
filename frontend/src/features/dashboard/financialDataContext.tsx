import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { FinancialDataContext, type FinancialDataContextValue } from './financialDataContextCore';
import { createEmptyState, type FinancialCoreState } from '../../services/financial/state';
import { LocalStorageRepository } from '../../services/financial/localStorageRepository';
import { createSupabaseRepository } from '../../services/supabase/supabaseRepository';
import { getSupabaseClient } from '../../services/supabase/client';
import { useAuth } from '../auth/useAuth';
import type { FinancialRepository, StoredFinancialState } from '../../services/financial/repository';
import { saveProfile, type ProfileInput } from '../../services/financial/profileService';
import {
  archiveAccount,
  createAccount,
  deleteAccount,
  unarchiveAccount,
  updateAccount,
  type AccountInput,
} from '../../services/financial/accountService';
import {
  createCategory,
  updateCategory,
  type CategoryInput,
} from '../../services/financial/categoryService';
import {
  createTransaction,
  deleteTransaction,
  updateTransaction,
  type TransactionInput,
} from '../../services/financial/transactionService';
import {
  createRecurring,
  deleteRecurring,
  toggleRecurringActive,
  updateRecurring,
  type RecurringInput,
} from '../../services/financial/recurringService';
import {
  createBudget,
  deleteBudget,
  updateBudget,
  type BudgetInput,
} from '../../services/financial/budgetService';
import {
  createGoal,
  deleteGoal,
  updateGoal,
  type GoalInput,
} from '../../services/financial/goalService';
import type { FinancialResult } from '../../services/financial/result';
import { deriveAccountBalances } from '../../services/financial/accountService';

/**
 * Financial Data Provider — the single source of truth for the FinWise
 * Financial Core.
 *
 * Data flow (Phase 3B):
 *
 *   UI pages
 *     -> actions (this provider)
 *     -> pure financial services (src/services/financial)
 *     -> FinancialRepository (SupabaseRepository when authenticated,
 *        LocalStorageRepository only as the unconfigured local fallback)
 *     -> Financial Intelligence Engine (src/intelligence/finance)
 *     -> dashboard/metrics
 *
 * REPOSITORY SELECTION (one clearly defined source of truth):
 *   * Supabase configured + authenticated user -> SupabaseRepository. Every
 *     statement runs with the user's session and is scoped by RLS.
 *   * Supabase NOT configured -> LocalStorageRepository (deliberate Phase 2
 *     fallback for development without a backend).
 *   * Supabase configured but signed out -> an honest empty state; local
 *     storage is never re-read behind an authenticated user's back.
 *
 * The provider hydrates from the active repository, then every mutation flows
 * through a pure service which returns a fresh state object; the provider
 * persists it and re-renders. No page owns or copies financial state.
 */

function hydrateFromStored(stored: StoredFinancialState): FinancialCoreState {
  const base: FinancialCoreState = {
    profile: stored.profile,
    accounts: stored.accounts,
    categories: stored.categories,
    transactions: stored.transactions,
    budgets: stored.budgets,
    goals: stored.goals,
    recurringTransactions: stored.recurringTransactions,
  };
  // Balances are always re-derived from initialBalance + effects so stored
  // (possibly stale) currentBalance values can never desync reality.
  const accounts = deriveAccountBalances(base.accounts, base.transactions);
  return { ...base, accounts };
}

export function FinancialDataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const supabaseClient = getSupabaseClient();
  const authUserId = user?.id ?? null;

  /**
   * Persistence identity of this store instance.
   *
   * Keyed remounting (React's recommended external-store reset pattern):
   * whenever the identity changes — sign-in, sign-out, or account switch —
   * the whole <FinancialDataStore /> below unmounts and a fresh one mounts
   * with clean state. No effect-driven reset, no stale store fields, and a
   * signed-out visitor can never see the previous local user's data.
   *
   * The persistence identity (not the user object) is the dependency, so a
   * token refresh or metadata change never remounts the store.
   */
  const persistenceIdentity =
    supabaseClient === null ? 'local' : (authUserId ?? 'signed-out');

  return <FinancialDataStore key={persistenceIdentity}>{children}</FinancialDataStore>;
}

/** Latest-wins guard shared by every concurrent load attempt. */
let activeLoadSequence = 0;

function FinancialDataStore({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const supabaseClient = getSupabaseClient();
  const [state, setState] = useState<FinancialCoreState>(createEmptyState);
  const [isHydrated, setIsHydrated] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const authUserId = user?.id ?? null;
  // A configured app with a signed-out visitor: protected routes keep them
  // out of financial pages, and the store holds an honest empty state —
  // deliberately NOT the previous local user's data (one source of truth).
  const signedOutConfigured = supabaseClient !== null && authUserId === null;
  const usesSupabase = supabaseClient !== null && authUserId !== null;

  const repository = useMemo<FinancialRepository>(() => {
    if (supabaseClient === null || authUserId === null || user === null) {
      return new LocalStorageRepository();
    }
    // The repository learns who the user is straight from the session the
    // auth provider has already resolved — ownership on every statement.
    return (
      createSupabaseRepository(supabaseClient, {
        getUserId: () => Promise.resolve(user.id),
        getEmail: () => Promise.resolve(user.email),
      }) ?? new LocalStorageRepository()
    );
  }, [supabaseClient, authUserId, user]);

  const commitStored = useCallback((stored: StoredFinancialState) => {
    setState(hydrateFromStored(stored));
    setIsHydrated(true);
  }, []);

  /**
   * Re-read the authoritative collections after a mutation.
   *
   * In Supabase mode this is what keeps the in-memory state consistent with
   * what RLS actually persisted: Phase 2 services mint prefixed ids
   * (`acct-<uuid>`, `cat-<uuid>`), the database stores real uuid primary
   * keys, and only a load adopts those database-assigned ids (plus
   * re-derived balances/budget spending) back into the state. Every later
   * mutation then references rows that truly exist, so foreign keys and the
   * RLS `owns_account`/`owns_category` checks always pass.
   */
  const refreshFromRepository = useCallback(async (): Promise<void> => {
    const sequence = ++activeLoadSequence;
    const stored = await repository.load();
    if (activeLoadSequence !== sequence) return;
    commitStored(stored);
  }, [repository, commitStored]);

  useEffect(() => {
    // Hydrate once per store mount — exactly one source-of-truth read per
    // persistence identity (app start, sign-in, sign-out, account switch).
    if (signedOutConfigured) {
      // Nothing to load: the empty state IS the signed-out truth.
      return;
    }
    const sequence = ++activeLoadSequence;

    void repository
      .load()
      .then((stored) => {
        if (activeLoadSequence !== sequence) return;
        commitStored(stored);
      })
      .catch((loadError: unknown) => {
        // A failed load must never crash the app: fall back to an honest
        // empty state so the user can keep working, and surface the message
        // through the shell banner.
        if (activeLoadSequence !== sequence) return;
        setState(createEmptyState());
        setIsHydrated(true);
        setLastError(loadError instanceof Error ? loadError.message : 'Could not load your financial data.');
      });
  }, [repository, commitStored, signedOutConfigured]);

  const clearLastError = useCallback(() => setLastError(null), []);

  // Actions (and their persistence helpers) are recreated whenever the
  // committed state changes so they never operate on stale data.
  const actions = useMemo(() => {
    /**
     * Wrap every action so a persistence failure is ALWAYS surfaced (the app
     * shell banner) and never silently dropped, while form flows keep
     * receiving the thrown error for their own inline display.
     */
    const withErrorReporting =
      <A extends unknown[]>(handler: (...args: A) => Promise<void>) =>
      async (...args: A): Promise<void> => {
        try {
          await handler(...args);
          setLastError(null);
        } catch (actionError) {
          setLastError(
            actionError instanceof Error ? actionError.message : 'Something went wrong while saving your data.',
          );
          throw actionError;
        }
      };

    const applyProfile = async (input: ProfileInput) => {
      const result = saveProfile(state, input);
      if (!result.ok) throw new Error(result.error.message);
      await repository.saveProfile(result.value.profile);
      if (result.value.seededCategories) {
        await repository.saveCategories(result.value.state.categories);
      }
      setState(result.value.state);
      if (usesSupabase) await refreshFromRepository();
    };

    const applyAccountChange = async <T,>(result: FinancialResult<{ state: FinancialCoreState } & T>) => {
      if (!result.ok) throw new Error(result.error.message);
      await repository.saveAccounts(result.value.state.accounts);
      setState(result.value.state);
      if (usesSupabase) await refreshFromRepository();
      return result.value;
    };

    const applyCategoryChange = async <T,>(result: FinancialResult<{ state: FinancialCoreState } & T>) => {
      if (!result.ok) throw new Error(result.error.message);
      await repository.saveCategories(result.value.state.categories);
      setState(result.value.state);
      if (usesSupabase) await refreshFromRepository();
      return result.value;
    };

    const applyTransactionChange = async <T,>(result: FinancialResult<{ state: FinancialCoreState } & T>) => {
      if (!result.ok) throw new Error(result.error.message);
      await repository.saveTransactions(result.value.state.transactions);
      await repository.saveAccounts(result.value.state.accounts);
      setState(result.value.state);
      if (usesSupabase) await refreshFromRepository();
      return result.value;
    };

    const applyRecurringChange = async <T,>(result: FinancialResult<{ state: FinancialCoreState } & T>) => {
      if (!result.ok) throw new Error(result.error.message);
      await repository.saveRecurringTransactions(result.value.state.recurringTransactions);
      setState(result.value.state);
      if (usesSupabase) await refreshFromRepository();
      return result.value;
    };

    const applyBudgetChange = async <T,>(result: FinancialResult<{ state: FinancialCoreState } & T>) => {
      if (!result.ok) throw new Error(result.error.message);
      await repository.saveBudgets(result.value.state.budgets);
      setState(result.value.state);
      if (usesSupabase) await refreshFromRepository();
      return result.value;
    };

    const applyGoalChange = async <T,>(result: FinancialResult<{ state: FinancialCoreState } & T>) => {
      if (!result.ok) throw new Error(result.error.message);
      await repository.saveGoals(result.value.state.goals);
      setState(result.value.state);
      if (usesSupabase) await refreshFromRepository();
      return result.value;
    };

    return {
      saveProfile: withErrorReporting(applyProfile),
      createAccount: withErrorReporting(async (input: AccountInput) => {
        await applyAccountChange(createAccount(state, input));
      }),
      updateAccount: withErrorReporting(async (id: string, input: AccountInput) => {
        await applyAccountChange(updateAccount(state, id, input));
      }),
      archiveAccount: withErrorReporting(async (id: string) => {
        await applyAccountChange(archiveAccount(state, id));
      }),
      unarchiveAccount: withErrorReporting(async (id: string) => {
        await applyAccountChange(unarchiveAccount(state, id));
      }),
      deleteAccount: withErrorReporting(async (id: string) => {
        await applyAccountChange(deleteAccount(state, id));
      }),
      createCategory: withErrorReporting(async (input: CategoryInput) => {
        await applyCategoryChange(createCategory(state, input));
      }),
      updateCategory: withErrorReporting(async (id: string, input: CategoryInput) => {
        await applyCategoryChange(updateCategory(state, id, input));
      }),
      addTransaction: withErrorReporting(async (input: TransactionInput, recurringSchedule?: RecurringInput) => {
        if (recurringSchedule) {
          // Link the one-off transaction to a new recurring schedule so the
          // transaction list and the schedule stay consistent.
          const recResult = createRecurring(state, recurringSchedule);
          if (!recResult.ok) throw new Error(recResult.error.message);
          const linkedInput: TransactionInput = {
            ...input,
            isRecurring: true,
            recurringTransactionId: recResult.value.recurring.id,
          };
          const txResult = createTransaction(recResult.value.state, linkedInput);
          if (!txResult.ok) throw new Error(txResult.error.message);
          await repository.saveTransactions(txResult.value.state.transactions);
          await repository.saveAccounts(txResult.value.state.accounts);
          await repository.saveRecurringTransactions(txResult.value.state.recurringTransactions);
          setState(txResult.value.state);
          if (usesSupabase) await refreshFromRepository();
          return;
        }
        await applyTransactionChange(createTransaction(state, input));
      }),
      updateTransaction: withErrorReporting(async (id: string, input: TransactionInput) => {
        await applyTransactionChange(updateTransaction(state, id, input));
      }),
      deleteTransaction: withErrorReporting(async (id: string) => {
        await applyTransactionChange(deleteTransaction(state, id));
      }),
      createRecurring: withErrorReporting(async (input: RecurringInput) => {
        await applyRecurringChange(createRecurring(state, input));
      }),
      updateRecurring: withErrorReporting(async (id: string, input: RecurringInput) => {
        await applyRecurringChange(updateRecurring(state, id, input));
      }),
      deleteRecurring: withErrorReporting(async (id: string) => {
        await applyRecurringChange(deleteRecurring(state, id));
      }),
      toggleRecurringActive: withErrorReporting(async (id: string, active: boolean) => {
        await applyRecurringChange(toggleRecurringActive(state, id, active));
      }),
      createBudget: withErrorReporting(async (input: BudgetInput) => {
        await applyBudgetChange(createBudget(state, input));
      }),
      updateBudget: withErrorReporting(async (id: string, input: BudgetInput) => {
        await applyBudgetChange(updateBudget(state, id, input));
      }),
      deleteBudget: withErrorReporting(async (id: string) => {
        await applyBudgetChange(deleteBudget(state, id));
      }),
      createGoal: withErrorReporting(async (input: GoalInput) => {
        await applyGoalChange(createGoal(state, input));
      }),
      updateGoal: withErrorReporting(async (id: string, input: GoalInput) => {
        await applyGoalChange(updateGoal(state, id, input));
      }),
      deleteGoal: withErrorReporting(async (id: string) => {
        await applyGoalChange(deleteGoal(state, id));
      }),
    };
  }, [state, repository, usesSupabase, refreshFromRepository]);

  const value = useMemo<FinancialDataContextValue>(
    () => ({
      ...state,
      isHydrated,
      lastError,
      clearLastError,
      actions,
    }),
    [state, isHydrated, lastError, clearLastError, actions],
  );

  return <FinancialDataContext.Provider value={value}>{children}</FinancialDataContext.Provider>;
}