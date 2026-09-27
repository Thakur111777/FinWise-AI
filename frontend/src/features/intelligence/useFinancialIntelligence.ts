import { useContext } from 'react';
import {
  FinancialIntelligenceContext,
  type FinancialIntelligenceContextValue,
} from './financialIntelligenceContextCore';

/** Access the derived Digital Twin and its guarded snapshot memory. */
export function useFinancialIntelligence(): FinancialIntelligenceContextValue {
  const context = useContext(FinancialIntelligenceContext);
  if (!context) {
    throw new Error('useFinancialIntelligence must be used within a <FinancialIntelligenceProvider>.');
  }
  return context;
}
