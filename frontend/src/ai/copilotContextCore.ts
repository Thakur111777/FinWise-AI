/**
 * The context/value contract for the Copilot conversation. Split into its own
 * file so `copilotContext.tsx` exports only components (react-refresh rule) —
 * the same pattern as `authContextCore.ts` / `financialDataContextCore.ts`.
 */
import { createContext } from 'react';

export type CopilotStatus = 'idle' | 'thinking' | 'error';

export interface CopilotMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
  failed?: boolean;
}

export interface CopilotContextValue {
  messages: CopilotMessage[];
  status: CopilotStatus;
  error: string | null;
  send: (text: string) => Promise<void>;
  retryLast: () => Promise<void>;
  clearConversation: () => void;
  maxInputLength: number;
}

export const CopilotContext = createContext<CopilotContextValue | null>(null);
