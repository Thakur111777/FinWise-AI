import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  askCopilot,
  CopilotError,
  type CopilotHistoryMessage,
} from './copilotService';
import {
  CopilotContext,
  type CopilotContextValue,
  type CopilotMessage,
  type CopilotStatus,
} from './copilotContextCore';

/**
 * Session-scoped Copilot conversation state.
 *
 * Types and the context object live in `copilotContextCore.ts` (so this file
 * exports only components for react-refresh); only the provider implementation
 * and its hooks live here.
 */

const MAX_HISTORY_MESSAGES = 8;
const MAX_INPUT_LENGTH = 2000;

let messageSequence = 0;
function nextMessageId(): string {
  messageSequence += 1;
  return `msg-${Date.now().toString(36)}-${messageSequence}`;
}

export function CopilotProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [status, setStatus] = useState<CopilotStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  // Keep the latest message list reachable from async callbacks without
  // re-creating them (the react-hooks/refs rule forbids writing the ref
  // during render, so it is synced in an effect instead).
  const messagesRef = useRef<CopilotMessage[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const request = useCallback(async (prompt: string) => {
    setStatus('thinking');
    setError(null);
    try {
      const history: CopilotHistoryMessage[] = messagesRef.current
        .filter((message) => !message.failed)
        .slice(-MAX_HISTORY_MESSAGES)
        .map((message) => ({ role: message.role, content: message.text }));
      const reply = await askCopilot(prompt, history);
      setMessages((previous) => [
        ...previous,
        {
          id: nextMessageId(),
          role: 'assistant',
          text: reply.text,
          createdAt: Date.now(),
        },
      ]);
      setStatus('idle');
    } catch (cause) {
      const message =
        cause instanceof CopilotError
          ? cause.message
          : 'Something went wrong. Please try again.';
      setMessages((previous) => [
        ...previous,
        {
          id: nextMessageId(),
          role: 'assistant',
          text: message,
          createdAt: Date.now(),
          failed: true,
        },
      ]);
      setError(message);
      setStatus('error');
    }
  }, []);

  const send = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      if (text.length === 0 || text.length > MAX_INPUT_LENGTH) return;
      if (status === 'thinking') return;
      setMessages((previous) => [
        ...previous,
        { id: nextMessageId(), role: 'user', text, createdAt: Date.now() },
      ]);
      await request(text);
    },
    [request, status],
  );

  const retryLast = useCallback(async () => {
    if (status === 'thinking') return;
    const lastUserMessage = [...messagesRef.current]
      .reverse()
      .find((message) => message.role === 'user');
    if (!lastUserMessage) return;
    setMessages((previous) => previous.filter((message) => !message.failed));
    await request(lastUserMessage.text);
  }, [request, status]);

  const clearConversation = useCallback(() => {
    setMessages([]);
    setError(null);
    setStatus('idle');
  }, []);

  const value = useMemo<CopilotContextValue>(
    () => ({
      messages,
      status,
      error,
      send,
      retryLast,
      clearConversation,
      maxInputLength: MAX_INPUT_LENGTH,
    }),
    [messages, status, error, send, retryLast, clearConversation],
  );

  return <CopilotContext.Provider value={value}>{children}</CopilotContext.Provider>;
}

