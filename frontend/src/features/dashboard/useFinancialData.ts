import { useContext } from 'react';
import {
  FinancialDataContext,
  type FinancialDataContextValue,
} from './financialDataContextCore';

export function useFinancialData(): FinancialDataContextValue {
  const context = useContext(FinancialDataContext);
  if (!context) {
    throw new Error('useFinancialData must be used within a <FinancialDataProvider>.');
  }
  return context;
}