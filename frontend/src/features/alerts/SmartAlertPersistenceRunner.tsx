import { useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../auth/useAuth';
import { useFinancialData } from '../dashboard/useFinancialData';
import { useDashboardMetrics } from '../dashboard/useDashboardMetrics';
import { useFinancialIntelligence } from '../intelligence/useFinancialIntelligence';
import { budgetUtilization, financialStateChanges, incomeExpenseTrend } from '../analytics/analyticsEngine';
import { detectCashGaps, detectSmallCharges } from '../analytics/hiddenSpendingDetector';
import { defaultCurrency } from '../financial/selectors';
import { createFinancialIntelligenceRepository } from '../../services/financial/intelligenceRepositoryFactory';
import { syncSmartAlerts } from '../../services/financial/smartAlertPersistence';
import { deriveSmartAlerts, type SmartAlertStatePoint } from './smartAlertEngine';
import type { IntelligenceSection } from '../../types/intelligence';

/** Runs the Phase 4D-3 writer after existing financial and snapshot stores hydrate. */
export function SmartAlertPersistenceRunner() {
  const auth = useAuth();
  const financial = useFinancialData();
  const metrics = useDashboardMetrics();
  const intelligence = useFinancialIntelligence();
  const lastSync = useRef<string | null>(null);
  const authUserId = auth.user?.id ?? null;
  const currencyCode = defaultCurrency(financial);
  const locale = financial.profile?.locale ?? 'en-US';

  const repository = useMemo(
    () => createFinancialIntelligenceRepository(authUserId === null ? null : { id: authUserId }),
    [authUserId],
  );

  const alertSection = useMemo(() => {
    const computedAt = new Date().toISOString();
    const analyticsInput = {
      transactions: financial.transactions,
      categories: financial.categories,
      budgets: financial.budgets,
      goals: financial.goals,
      recurringTransactions: financial.recurringTransactions,
      accounts: financial.accounts,
      profile: financial.profile,
      snapshots: intelligence.snapshots,
      metrics,
    };
    const detectorInput = {
      transactions: financial.transactions,
      categories: financial.categories,
      recurringTransactions: financial.recurringTransactions,
      accounts: financial.accounts,
    };
    const state = financialStateChanges(analyticsInput, computedAt);
    const financialState: IntelligenceSection<SmartAlertStatePoint[]> = state.status === 'available'
      ? {
          ...state,
          data: state.data.map((point) => ({
            capturedAt: point.capturedAt,
            netWorth: point.netWorth,
            financialHealthScore: point.healthScore,
            safeToSpend: point.safeToSpend,
          })),
        }
      : state;

    return deriveSmartAlerts({
      computedAt,
      currencyCode,
      locale,
      categories: financial.categories.map(({ id, name }) => ({ id, name })),
      budgets: budgetUtilization(analyticsInput, computedAt),
      smallCharges: detectSmallCharges(detectorInput, computedAt),
      cashGaps: detectCashGaps(detectorInput, computedAt),
      financialState,
      cashFlow: incomeExpenseTrend(analyticsInput, computedAt),
    });
  }, [
    financial.accounts,
    financial.budgets,
    financial.categories,
    financial.goals,
    financial.profile,
    financial.recurringTransactions,
    financial.transactions,
    intelligence.snapshots,
    currencyCode,
    locale,
    metrics,
  ]);

  useEffect(() => {
    const canPersist = auth.isLocalMode || authUserId !== null;
    if (!financial.isHydrated || !canPersist || intelligence.snapshotsLoading) return;

    const identity = auth.isLocalMode ? 'local' : authUserId!;
    const signature = `${identity}:${JSON.stringify(alertSection)}`;
    if (lastSync.current === signature) return;
    lastSync.current = signature;

    void syncSmartAlerts(repository, alertSection).catch((error: unknown) => {
      if (lastSync.current === signature) lastSync.current = null;
      console.error('Could not sync smart alerts to financial insights.', error);
    });
  }, [
    alertSection,
    auth.isLocalMode,
    authUserId,
    financial.isHydrated,
    intelligence.snapshotsLoading,
    repository,
  ]);

  return null;
}
