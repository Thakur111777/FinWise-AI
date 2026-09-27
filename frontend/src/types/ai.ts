export type AIProvider = 'gemini' | 'openai' | 'claude' | 'custom';

export interface AIProviderConfig {
  provider: AIProvider;
  model: string;
  endpoint?: string;
  apiKeyRef?: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * A single prior conversational turn sent with a Copilot request.
 *
 * Bounded by the client (max 8 messages) and re-validated/length-capped by the
 * Edge Function. History is untrusted user text: it shapes conversational flow
 * but never overrides the authoritative financial context the server builds.
 */
export interface CopilotHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Request the browser sends to the secure FinWise Copilot Edge Function.
 *
 * IMPORTANT:
 * - The browser MUST NOT send an AI provider secret.
 * - The browser MUST NOT send a user_id that the server trusts for authorization.
 * - Identity is derived server-side from the authenticated Supabase request.
 * - Financial facts are derived server-side from the authenticated user's own
 *   rows (RLS). The browser does not send financial data for the server to trust.
 */
export interface CopilotRequest {
  /** The user's natural-language question. Non-empty, length-capped. */
  prompt: string;
  /**
   * Optional bounded conversation history (recent turns only).
   * Treated as untrusted input by the server.
   */
  history?: CopilotHistoryMessage[];
  /** Convenience metadata for logging/audit only. Not used for authz. */
  metadata?: Record<string, unknown>;
}

/**
 * Response the Edge Function returns to the browser.
 *
 * The provider field names the server-side provider that generated the answer.
 * `model` names the model used. The frontend does not need to know provider
 * internals or API keys.
 */
export interface CopilotResponse {
  answer: string;
  provider: AIProvider;
  model: string;
  generatedAt: string;
  /** Present when the request was rejected or could not be processed. */
  error?: string;
}

export interface AIResponse {
  provider: AIProvider;
  model: string;
  answer: string;
  confidence: number;
  citations?: string[];
  generatedAt: string;
}

export interface AIProviderAdapter {
  provider: AIProvider;
  generate: (request: AIRequestContext) => Promise<AIResponse>;
}

export interface AIRequestContext {
  userId: string;
  prompt: string;
  context: Record<string, unknown>;
  provider: AIProvider;
}
