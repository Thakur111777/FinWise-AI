import { createContext } from 'react';
import type { FinancialSnapshot } from '../../types/financial';
import type { FinancialTwin } from '../../intelligence/twin';

/**
 * Shared context core for the Financial Intelligence store (Phase 4B).
 *
 * Split from the provider component and the consuming hook so the
 * react-refresh rule (components-only exports) stays clean — the same pattern
 * as financialDataContextCore.ts and copilotContextCore.ts.
 */
export interface FinancialIntelligenceActions {
  /**
   * Capture a Digital Twin snapshot now. The write itself is the guarded
   * repository operation — nothing in the UI computes or persists a number.
   */
  captureSnapshot(): Promise<void>;
}

export interface FinancialIntelligenceContextValue {
  /**
   * The derived Digital Twin — built ONCE per financial state change in the
   * provider. Consumers render it; they never re-derive it.
   */
  twin: FinancialTwin;
  /** Latest-first bounded snapshot history (the twin's point-in-time memory). */
  snapshots: FinancialSnapshot[];
  /** True while the snapshot history is being read from the repository. */
  snapshotsLoading: boolean;
  /** Message of the most recent failed snapshot history read, or null. */
  snapshotError: string | null;
  /** True while a guarded snapshot capture is in flight. */
  capturing: boolean;
  /** Message of the most recent failed snapshot capture, or null. */
  captureError: string | null;
  actions: FinancialIntelligenceActions;
}

export const FinancialIntelligenceContext = createContext<FinancialIntelligenceContextValue | null>(null);
