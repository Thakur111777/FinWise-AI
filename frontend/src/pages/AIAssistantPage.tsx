import { useCallback, useEffect } from 'react';
import type { FormEvent } from 'react';
import { Sparkles } from 'lucide-react';
import { useCopilot } from '../ai/useCopilot';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Button } from '../components/ui/forms';

/**
 * FinWise Copilot page.
 *
 * Conversational UI over the secure AI boundary. Session-scoped, bounded
 * history, and full loading/error/empty/retry states. Informational only —
 * the Copilot cannot mutate financial data in Phase 3C.
 */

const SUGGESTED_QUESTIONS = [
  'How much did I spend this month?',
  'Where am I spending the most?',
  'How much money do I have available?',
  'What are my biggest recurring expenses?',
  'What should I watch out for financially?',
];

export function AIAssistantPage() {
  const { messages, status, send, retryLast, clearConversation, maxInputLength } =
    useCopilot();

  const isThinking = status === 'thinking';
  const canRetry = status === 'error';

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = event.currentTarget;
      const input = form.elements.namedItem('prompt') as HTMLTextAreaElement | null;
      if (!input) return;
      const value = input.value;
      input.value = '';
      void send(value).catch(() => undefined);
    },
    [send],
  );

  useEffect(() => {
    const scroller = document.getElementById('copilot-messages');
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [messages, isThinking]);

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-slate-500">BumShankar AI</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">BumShankar AI 🔱🕉️</h1>
          <p className="mt-2 max-w-xl text-sm text-slate-600">
            Your Personal Financial Intelligence Assistant. Ask about your real
            FinWise data — balances, spending, budgets, and goals. BumShankar AI
            explains; it never changes your records.
          </p>
        </div>
        {messages.length > 0 && (
          <Button variant="secondary" onClick={clearConversation} disabled={isThinking}>
            Clear chat
          </Button>
        )}
      </header>

      <Card className="flex flex-col overflow-hidden p-0">
        <div
          id="copilot-messages"
          aria-live="polite"
          className="flex h-[24rem] min-h-0 flex-col gap-3 overflow-y-auto p-4 md:h-[30rem]"
        >
          {messages.length === 0 && !isThinking ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4">
              <EmptyState
                icon={Sparkles}
                title="Hi! I'm BumShankar AI 🔱🕉️"
                description="Ask me anything about your finances — answers use your actual FinWise data, never invented figures."
                className="border-none bg-transparent"
              />
              <div className="flex max-w-md flex-wrap justify-center gap-2">
                {SUGGESTED_QUESTIONS.map((question) => (
                  <Button
                    key={question}
                    variant="secondary"
                    disabled={isThinking}
                    onClick={() => void send(question).catch(() => undefined)}
                  >
                    {question}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={
                  message.role === 'user'
                    ? 'self-end max-w-[85%] rounded-2xl rounded-br-sm bg-teal-700 px-4 py-2 text-sm text-white'
                    : message.failed
                      ? 'self-start max-w-[85%] rounded-2xl rounded-bl-sm border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700'
                      : 'self-start max-w-[85%] rounded-2xl rounded-bl-sm bg-slate-100 px-4 py-2 text-sm text-slate-900'
                }
              >
                {message.text}
              </div>
            ))
          )}

          {isThinking && (
            <div
              role="status"
              className="self-start max-w-[85%] rounded-2xl rounded-bl-sm bg-slate-100 px-4 py-2 text-sm text-slate-500"
            >
              BumShankar AI 🔱🕉️ is thinking…
            </div>
          )}
        </div>

        {canRetry && (
          <div className="border-t border-slate-200 px-4 py-2">
            <Button variant="secondary" onClick={() => void retryLast().catch(() => undefined)}>
              Retry last question
            </Button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex items-end gap-2 border-t border-slate-200 p-3">
          <textarea
            name="prompt"
            rows={2}
            maxLength={maxInputLength}
            placeholder="Ask BumShankar AI about your finances…"
            aria-label="Ask BumShankar AI"
            className="min-h-0 flex-1 resize-none rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
            disabled={isThinking}
          />
          <Button type="submit" disabled={isThinking}>
            {isThinking ? 'Sending…' : 'Send'}
          </Button>
        </form>
      </Card>

      <p className="text-xs text-slate-500">
        BumShankar AI is informational only and cannot create or change
        transactions, accounts, budgets, or goals. Answers are grounded in a
        secure, server-side view of your own data — figures are never invented.
      </p>
    </div>
  );
}
