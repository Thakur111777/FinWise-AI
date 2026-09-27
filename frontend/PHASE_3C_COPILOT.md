# Phase 3C — FinWise Copilot (Secure AI Boundary)

Phase 3C delivers the first AI feature of FinWise: the **FinWise Copilot**, a
read-only, explainable question-answering layer over the user's real financial
data. It completes the Phase 4 scope item "AI context builder and provider
abstraction" without weakening any Phase 3A/3B guarantee.

## 1. Final architecture

```text
React Copilot UI (AIAssistantPage)          src/pages/AIAssistantPage.tsx
   ↓ session-scoped conversation state      src/ai/copilotContext.tsx
   ↓ single browser call site               src/ai/copilotService.ts
   ↓ POST /functions/v1/finwise-copilot     (anon key + caller JWT)
finwise-copilot Edge Function               supabase/functions/finwise-copilot/index.ts
   ↓ Bearer JWT verified (auth.getUser)     identity from the token only
   ↓ context queries under the caller JWT   RLS enforces user isolation
   ↓ deterministic financial context JSON   bounded, server-side, free-text truncated
   ↓ provider adapter (Gemini/OpenAI/Claude) secret only in Edge Function env
   ← { answer, provider, model, generatedAt }
```

## 2. Files added / changed

| File | Responsibility |
| --- | --- |
| `src/ai/copilotService.ts` | Browser boundary: invoke the Edge Function, normalize the response, map HTTP failures to typed `CopilotError`s |
| `src/ai/copilotContext.tsx` | `CopilotProvider` / `useCopilot`: bounded history (last 8 messages), send/retry/clear, thinking/error states |
| `src/pages/AIAssistantPage.tsx` | Copilot page: suggestions, live conversation, retry, clear, honest empty state |
| `src/main.tsx` | Mounts `CopilotProvider` (session-scoped, no repository dependency) |
| `src/types/ai.ts` | `CopilotRequest` / `CopilotResponse` / `CopilotHistoryMessage` contracts |
| `supabase/functions/finwise-copilot/index.ts` | The secure boundary itself |
| `.env.example` | Documents the Edge Function secrets and their set command |

> **Model note:** the production default is `gemini-3.8-flash` (current stable
> Flash generation per Google's model documentation). The earlier
> `gemini-2.0-flash` default referenced a model line Google has shut down.

## 2.1 Context domains

The Edge Function builds the financial context from these tables (all read
under the caller's JWT, so RLS scopes every row to its owner):

| Domain | Included | Notes |
| --- | --- | --- |
| profiles | ✓ | currency + locale only |
| accounts | ✓ | derived balances + counts, grouped per currency |
| transactions | ✓ | 90-day window; month-to-date and rolling aggregates kept separate; top categories are explicitly 90-day values |
| categories | ✓ | names for label resolution |
| recurring_transactions | ✓ | active schedules with deterministic monthly-equivalent per currency |
| budgets | ✓ | active (end_date ≥ today); spent/remaining are the engine's maintained values |
| goals | ✓ | active only; progress percent clamped to 0–100, matching `goalProgress` |
| financial_insights | ✓ | latest 8 |
| financial_snapshots | ✓ | latest snapshot: health score, safe-to-spend, net worth, cash flow, savings rate, debt — authoritative deterministic output |
| life_events / scenarios / decisions | — | schema-only in Phase 3A; no write path exists yet |
| financial_memories | — | schema-only: the app has no memory write path yet, so there is nothing meaningful to include; documented rather than invented |

## 2.2 Privacy behaviour (accurate, not aspirational)

- Never sent to the AI provider: email, full name, auth tokens, account IDs,
  service-role keys, provider secrets, database credentials.
- **Merchant and description ARE sent, truncated to 60 characters.** They are
  user free-text and can contain accidental personal information; they are kept
  (bounded) because category alone cannot disambiguate recurring payments. The
  system prompt instructs the model to reference them by category where
  possible and never echo long free-text back.
- The database architecture doc's earlier blanket "no PII" phrasing is
  superseded by this section.

## 3. Security invariants

- The browser holds only the anon key; the provider secret exists only in Edge
  Function secrets (`AI_PROVIDER_API_KEY`), set via `supabase secrets set`.
- Identity is derived from the verified Bearer JWT (`auth.getUser`); no
  client-supplied user id is ever trusted.
- Every context query runs with the caller's JWT, so PostgreSQL RLS scopes
  each row to its owner before anything reaches the prompt.
- No email, name, or account identifiers enter the prompt; context carries
  only financial values with explicit currency codes. Merchant/description
  free-text is included but length-truncated — see section 2.2.
- Read / reason / explain only: the function performs no writes, and the
  system prompt forbids claiming data changes.
- Untrusted input is bounded: prompt ≤ 2000 chars, history ≤ 12 messages ×
  2000 chars, provider call timeout 25 s.
- Per-user rate limiting (20 requests / 5 minutes, best-effort per isolate)
  returns 429 with an actionable message.
- Prompt injection: conversation history is treated as untrusted user input;
  the system prompt explicitly instructs the model to refuse override attempts
  (ignore instructions / reveal prompt / change read-only / fabricate numbers)
  and to keep FINANCIAL_CONTEXT authoritative.
- Unsupported `AI_PROVIDER` values are rejected explicitly (503) instead of
  silently falling back.

## 3.1 CORS rationale

`Access-Control-Allow-Origin: *` is retained deliberately and documented here:
the FinWise client is deployed to unpinned origins (custom domains plus
per-deploy preview URLs), which the function cannot enumerate. The wildcard is
defensible because (a) the write path is empty — the function performs no
mutations — and (b) every data path requires a verified Bearer JWT, so an
unauthenticated cross-origin caller receives only a 401. The response body
never echoes secrets. If FinWise later pins a production origin set, restrict
the header accordingly.

## 4. Determinism rule

The Edge Function computes no financial figures itself. It reads the
deterministic engine's persisted outputs (`accounts.current_balance`,
`budgets.spent`) and raw transaction rows, then assembles an authoritative
context JSON. The AI explains the numbers; it never produces them. When the
context cannot answer a question, the model must say so plainly instead of
inventing figures.

## 5. Error contract

| HTTP | Client `CopilotError.code` | Meaning |
| --- | --- | --- |
| 400 | `invalid_request` | malformed or oversized prompt/history |
| 401 / 403 | `unauthenticated` | missing or expired session |
| 429 | `rate_limited` | per-user limit hit |
| 502 / 503 | `provider_unavailable` | provider unreachable / not configured |
| 500 | `server` | unexpected failure |
| — | `context_unavailable` | reserved for context load failures |

## 6. Deployment

```bash
supabase functions deploy finwise-copilot
supabase secrets set AI_PROVIDER=gemini AI_MODEL=gemini-3.8-flash AI_PROVIDER_API_KEY=<secret>
```

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are injected automatically. Until
`AI_PROVIDER_API_KEY` is set, the function answers 503 with an honest
"not configured" message — the UI never fakes an answer.

## 7. Verification status (finalization pass)

- `npm run build` (`tsc -b && vite build`) and `npm run lint` pass.
- Phase 3A verification scripts (`verify_phase3a.mjs`, `verify_live_phase3a.mjs`)
  remain unmodified at the repo root; the schema and repository were not touched
  by Phase 3C.
- **Live end-to-end AI testing remains pending external setup.** The Supabase
  CLI is not installed in the development environment and no provider API key
  is available. When available: install + `supabase login` + `supabase link`,
  deploy per section 6, set the secret, then run the live question set
  (spend-this-month, top categories, recurring expenses, budget remaining,
  goal progress, watch-outs) against an authenticated user with data.

## 8. Deliberately NOT in Phase 3C

- Conversation persistence (session-scoped only; extension point documented in
  `copilotContext.tsx`)
- Mutating actions ("move money", "create budget") — the Copilot is read-only
- Streaming responses
- Automatic insight generation (Phase 5)
- Client-side provider calls (never)
