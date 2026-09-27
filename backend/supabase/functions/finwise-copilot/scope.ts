/**
 * FinWise Copilot — open-ended financial-intent scope classifier.
 *
 * DESIGN CONTRACT (deliberately NOT a question whitelist):
 *   The Copilot supports OPEN-ENDED financial intent: balances, income,
 *   expenses, spending, cash flow, budgets, savings, goals, affordability,
 *   planning, trade-offs, what-if scenarios, debt, credit, taxes, insurance,
 *   investing, and the financial impact of real-world decisions — including
 *   questions never anticipated at development time.
 *
 * Classification strategy (fail-open, high-precision rejection):
 *   1. ANY financial-intent signal  -> in_scope (broad concept lexicon, not a
 *      list of allowed questions).
 *   2. ELSE a clearly non-financial domain marker (coding, science,
 *      entertainment, sports, factual general knowledge) -> out_of_scope.
 *      Gemini is never called for these, preserving quota.
 *   3. ELSE a bare informational query ("tell me about X", "what is X") with
 *      NO personal/financial anchor (my/me/mine/our/we/i/finwise)
 *      -> out_of_scope ("Tell me about Japan." vs "Tell me about my spending.").
 *   4. ELSE -> in_scope. Ambiguous but plausibly financial questions
 *      ("What laptop should I buy?") stay in the Copilot flow rather than
 *      being rejected — false rejection is prioritised against.
 *
 * This module is PURE (no Deno/network APIs) so it is unit-testable in Node.
 */

export type FinancialIntentVerdict = 'in_scope' | 'out_of_scope';

/**
 * Broad financial-intent lexicon: concepts, not canned questions. Multiword
 * concepts ('emergency fund', 'credit score') and intent patterns
 * ('can i afford', 'affect my') cover novel financial questions.
 */
const FINANCIAL_TERMS: string[] = [
  // Money & accounts
  'money', 'cash', 'cash flow', 'cashflow', 'bank', 'banking', 'balance',
  'balances', 'account', 'accounts', 'wallet', 'net worth', 'finances',
  'finwise',
  // Income
  'income', 'salary', 'salaries', 'wage', 'wages', 'paycheck', 'paycheque',
  'paid', 'paying', 'earnings', 'earning', 'allowance', 'pocket money',
  'side hustle',
  // Spending
  'spend', 'spending', 'spent', 'expense', 'expenses', 'recurring',
  'subscription', 'subscriptions', 'bill', 'bills', 'fee', 'fees', 'purchase',
  'purchasing', 'price', 'pricing', 'cost', 'costs', 'costly', 'cheap',
  'cheaper', 'cheapest', 'expensive', 'worth it', 'refund', 'discount',
  // Budgeting & planning
  'budget', 'budgets', 'budgeting', 'afford', 'affordable', 'affordability',
  'financial', 'finance', 'financially', 'fiscal', 'financial plan',
  'financial planning', 'emergency fund', 'rainy day', 'down payment',
  'installment', 'instalment', 'emi',
  // Savings & goals
  'save', 'saved', 'saving', 'savings', 'goal', 'goals', 'target amount',
];

/** Debt, credit, tax, insurance, investing, currency, decision-intent terms. */
const FINANCIAL_TERMS_PART2: string[] = [
  'debt', 'debts', 'loan', 'loans', 'borrow', 'borrowing', 'credit',
  'credit score', 'credit card', 'repay', 'repayment', 'interest',
  'mortgage', 'overdraft',
  'tax', 'taxes', 'taxable', 'taxation', 'gst', 'vat', 'deduction',
  'deductions', 'insurance', 'insured', 'premium', 'claim',
  'invest', 'investing', 'investment', 'investments', 'investor', 'stocks',
  'stock', 'shares', 'stock market', 'mutual fund', 'mutual funds', 'sip',
  'portfolio', 'dividend', 'compound interest', 'inflation', 'recession',
  'wealth', 'retirement', 'pension', 'provident fund',
  'currency', 'currencies', 'rupee', 'rupees', 'dollar', 'dollars', 'euro',
  'euros', 'pound', 'pounds', 'inr', 'usd', 'eur', 'gbp', 'lakh', 'crore',
  'amount', 'amounts',
  // Affordability / real-world decision intent patterns
  'can i afford', 'can i buy', 'should i buy', 'can i get', 'can i go',
  'can i travel', 'can i move', 'should i invest', 'should i save',
  'what if i', 'what if', 'affect my', 'impact my', 'effect my',
  'with what i have', 'within my', 'my budget', 'my savings', 'my money',
  'my debt', 'my tax', 'my taxes', 'my loan', 'my goal', 'my goals',
  'my account', 'my accounts', 'my investments', 'how much', 'how many',
  'how long until', 'safe to spend',
];

/** High-precision CLEARLY non-financial markers (used only when no financial signal exists). */
const NON_FINANCIAL_MARKERS: string[] = [
  // Science & nature
  'photosynthesis', 'gravity', 'black hole', 'big bang', 'quantum', 'atom',
  'molecule', 'molecules', 'dna', 'rna', 'evolution', 'dinosaur', 'dinosaurs',
  'volcano', 'earthquake', 'solar system', 'speed of light', 'physics',
  'chemistry', 'biology', 'astronomy', 'neutron', 'electron',
  'climate change', 'weather', 'rainfall', 'eclipse',
  // General knowledge / factual
  'prime minister', 'president of', 'capital of', 'population of',
  'tallest mountain', 'longest river', 'world war', 'who won', 'when did',
  'when was', 'history of the', 'geography', 'meaning of life',
  // Coding & tech
  'write code', 'coding', 'javascript', 'typescript', 'python', 'java code',
  'c++', 'golang', 'sql query', 'html', 'css', 'react component', 'regex',
  'algorithm', 'data structure', 'debug', 'compile', 'api endpoint',
  // Entertainment & sports
  'movie', 'movies', 'film', 'netflix', 'anime', 'song', 'songs', 'lyrics',
  'album', 'football', 'soccer', 'cricket match', 'basketball', 'tennis',
  'ipl', 'world cup', 'olympics', 'match score', 'video game', 'gaming',
  // Writing / homework
  'essay', 'homework', 'poem', 'poetry', 'short story', 'write a story',
  'joke', 'jokes',
];

/** Bare informational-question starters (no personal anchor required). */
const INFORMATIONAL_STARTERS: string[] = [
  'tell me about', 'what is', 'what are', 'what was', 'who is', 'who was',
  'where is', 'where was', 'explain', 'define', 'describe', 'how does',
  'how do',
];

/** Personal/financial anchor: the question is about the user's own situation. */
const PERSONAL_ANCHORS: string[] = ['my ', ' me ', 'mine', 'our ', ' we ', ' i ', "i'm", "i've", 'finwise'];

function escapeRegExp(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Lowercase, strip punctuation (apostrophes kept), collapse + pad whitespace. */
function normalize(message: string): string {
  return ` ${message
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `;
}

function buildTermMatcher(terms: string[]): (text: string) => boolean {
  const patterns = terms.map(
    (term) =>
      new RegExp(`(^|\\s)${term.split(' ').map(escapeRegExp).join('\\s+')}($|\\s)`),
  );
  return (text: string) => patterns.some((pattern) => pattern.test(text));
}

const hasFinancialSignal = buildTermMatcher([
  ...FINANCIAL_TERMS,
  ...FINANCIAL_TERMS_PART2,
]);
const hasNonFinancialMarker = buildTermMatcher(NON_FINANCIAL_MARKERS);
const hasInformationalStarter = buildTermMatcher(INFORMATIONAL_STARTERS);

function hasPersonalAnchor(text: string): boolean {
  return PERSONAL_ANCHORS.some((anchor) => text.includes(anchor));
}

/**
 * Classify a complete user message by underlying intent (never a keyword check).
 *
 * @param message The COMPLETE user message.
 * @returns 'in_scope' unless the message is CLEARLY non-financial.
 */
export function classifyFinancialIntent(message: string): FinancialIntentVerdict {
  const text = normalize(message);

  // Rule 1 — any financial-intent signal anywhere in the message wins.
  if (hasFinancialSignal(text)) return 'in_scope';

  // Rule 2 — clearly non-financial domain with no financial signal: reject.
  //   Informational starters ("tell me about", "what is", …) act as weak
  //   non-financial markers here so bare "Tell me about Japan." rejects,
  //   while "Tell me about my spending." already passed rule 1 via 'my
  //   spending' and "How do movie credits work?" passes via 'credit'.
  if (hasNonFinancialMarker(text) || hasInformationalStarter(text)) {
    return 'out_of_scope';
  }

  // Rule 3 — bare informational query with no personal anchor: reject.
  //   "Tell me about Japan." / "Who is the prime minister of India?" reject;
  //   "Tell me about my spending." stays (rule 1 via 'my spending').
  if (hasInformationalStarter(text) && !hasPersonalAnchor(text)) {
    return 'out_of_scope';
  }

  // Rule 4 — fail-open: ambiguous but plausibly financial stays in the flow.
  return 'in_scope';
}

