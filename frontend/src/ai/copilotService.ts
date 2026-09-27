import { FunctionsHttpError } from '@supabase/supabase-js';
import { getSupabaseClient } from '../services/supabase/client';
import type { CopilotHistoryMessage } from '../types/ai';

/**
 * Browser-side Copilot boundary.
 *
 * The browser never talks to an AI provider and never holds an AI secret.
 * Every request goes to the authenticated Supabase Edge Function
 * `finwise-copilot`, which derives authoritative financial context
 * server-side and returns a normalized answer.
 */

/**
 * The canonical shape lives in `types/ai.ts` (shared with the Edge Function
 * contract); re-exported here so consumers keep a single import surface.
 */
export type { CopilotHistoryMessage };

export interface CopilotExchange {
  text: string;
  model: string;
  generatedAt: string;
}

export type CopilotFailureCode =
  | 'unauthenticated'
  | 'invalid_request'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'context_unavailable'
  | 'server';

export class CopilotError extends Error {
  readonly code: CopilotFailureCode;

  constructor(code: CopilotFailureCode, message: string) {
    super(message);
    this.name = 'CopilotError';
    this.code = code;
  }
}

const FUNCTION_NAME = 'finwise-copilot';

interface CopilotResponsePayload {
  answer?: unknown;
  model?: unknown;
  generatedAt?: unknown;
  error?: unknown;
  message?: unknown;
  providerStatus?: unknown;
}

const STATUS_TO_CODE: Record<number, CopilotFailureCode> = {
  400: 'invalid_request',
  401: 'unauthenticated',
  403: 'unauthenticated',
  404: 'server',
  429: 'rate_limited',
  500: 'server',
  502: 'provider_unavailable',
  503: 'provider_unavailable',
};

const CODE_TO_MESSAGE: Record<CopilotFailureCode, string> = {
  unauthenticated: 'Please sign in again to use BumShankar AI.',
  invalid_request: 'That question could not be sent. Try rephrasing it.',
  rate_limited: 'BumShankar AI is busy right now. Please try again in a moment.',
  provider_unavailable: 'The AI service is temporarily unavailable. Please try again shortly.',
  context_unavailable: 'Your financial context could not be loaded. Please try again.',
  server: 'Something went wrong. Please try again.',
};

async function toCopilotError(cause: unknown): Promise<CopilotError> {
  if (cause instanceof FunctionsHttpError) {
    const status = typeof cause.context?.status === 'number' ? cause.context.status : 500;
    const code = STATUS_TO_CODE[status] ?? 'server';
    let detail: string | undefined;
    try {
      const payload = (await cause.context.json()) as CopilotResponsePayload | null;
      // Supabase Functions errors use `message` (and sometimes `code`);
      // provider errors from the Edge Function use `error`. Prefer `error`,
      // then fall back to `message` so 404/NOT_FOUND and similar get a useful
      // message instead of the generic server fallback.
      if (payload && typeof payload.error === 'string') {
        detail = payload.error;
        // The Edge Function now appends the safe, non-secret provider status
        // (e.g. "(provider 400)") to the 502 body so TEST 1 failures are
        // diagnosable from the app without ever exposing secrets or raw
        // provider bodies. Preserve it verbatim here.
        if (typeof payload.providerStatus === 'number') {
          detail = `${detail} [provider ${payload.providerStatus}]`;
        }
      } else if (payload && typeof payload.message === 'string') {
        detail = payload.message;
      }
    } catch {
      // Body already consumed or unreadable — fall back to the status mapping.
    }
    return new CopilotError(code, detail ?? CODE_TO_MESSAGE[code]);
  }
  if (cause instanceof CopilotError) return cause;
  return new CopilotError('server', CODE_TO_MESSAGE.server);
}

/**
 * Ask FinWise Copilot a question.
 *
 * The user's JWT is attached automatically by the Supabase client, so the
 * Edge Function can verify the caller and scope all context queries with RLS.
 */
export async function askCopilot(
  prompt: string,
  history: CopilotHistoryMessage[] = [],
): Promise<CopilotExchange> {
  const client = getSupabaseClient();
  if (client === null) {
    // Unconfigured Supabase means there is no secure backend to ask — and no
    // sign-in to authenticate with. Honest unavailability, never a fake answer.
    throw new CopilotError(
      'server',
      'BumShankar AI is unavailable: the Supabase backend is not configured in this environment.',
    );
  }
  let payload: CopilotResponsePayload | null;
  try {
    const { data, error } = await client.functions.invoke(FUNCTION_NAME, {
      body: { prompt, history },
    });
    if (error) throw error;
    payload = (data ?? null) as CopilotResponsePayload | null;
  } catch (cause) {
    throw await toCopilotError(cause);
  }

  if (!payload || typeof payload !== 'object') {
    throw new CopilotError('server', CODE_TO_MESSAGE.server);
  }

  const answer = typeof payload.answer === 'string' ? payload.answer.trim() : '';
  if (answer.length === 0) {
    throw new CopilotError('server', 'BumShankar AI returned an empty response.');
  }

  return {
    text: answer,
    model: typeof payload.model === 'string' ? payload.model : 'unknown',
    generatedAt:
      typeof payload.generatedAt === 'string'
        ? payload.generatedAt
        : new Date().toISOString(),
  };
}
