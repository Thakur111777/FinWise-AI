import { useContext } from 'react';
import { CopilotContext, type CopilotContextValue } from './copilotContextCore';

/**
 * Accessor for the session-scoped Copilot conversation. Lives in its own file
 * (rather than beside `CopilotProvider`) so the provider file exports only
 * components for react-refresh — the same pattern as `features/auth/useAuth.ts`.
 */
export function useCopilot(): CopilotContextValue {
  const context = useContext(CopilotContext);
  if (!context) {
    throw new Error('useCopilot must be used within a CopilotProvider');
  }
  return context;
}
