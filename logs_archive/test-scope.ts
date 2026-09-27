/**
 * Static classification tests for the open-ended financial-intent scope guard.
 *
 * Run: node test-scope.ts   (Node >= 22.18)
 * No network, no Gemini calls, no secrets — pure classifier verification.
 *
 * The classifier lives in supabase/functions/finwise-copilot/scope.ts, whose
 * nearest package.json is "commonjs"; to unit-test it without touching that
 * packaging file, this test strips TS types itself and imports the generated
 * ESM copy (behaviour-identical to how the Edge Function imports it).
 */
import { stripTypeScriptTypes } from 'node:module';
import * as fs from 'node:fs';

const SOURCE = 'supabase/functions/finwise-copilot/scope.ts';
const GENERATED = 'scope.generated.test.mjs';

const js = stripTypeScriptTypes(fs.readFileSync(SOURCE, 'utf8'), { mode: 'strip' });
fs.writeFileSync(GENERATED, js);
const { classifyFinancialIntent } = await import(`./${GENERATED}`);

interface Case {
  intent: string;
  message: string;
  expected: 'in_scope' | 'out_of_scope';
}

const CASES: Case[] = [
  // 1. Direct financial data
  { intent: '1 direct-data', message: 'What is my current total balance?', expected: 'in_scope' },
  { intent: '1 direct-data', message: 'Give me a brief summary of my current financial situation based on my data.', expected: 'in_scope' },
  // 2. Spending analysis
  { intent: '2 spending', message: 'Where am I spending the most this month?', expected: 'in_scope' },
  { intent: '2 spending', message: 'How much did I spend on food recently?', expected: 'in_scope' },
  // 3. Budgeting
  { intent: '3 budgeting', message: 'How are my budgets doing?', expected: 'in_scope' },
  // 4. Savings
  { intent: '4 savings', message: 'How much should I keep in an emergency fund?', expected: 'in_scope' },
  // 5. Financial planning
  { intent: '5 planning', message: 'Help me plan my finances for the next year.', expected: 'in_scope' },
  // 6. Affordability
  { intent: '6 affordability', message: 'Can I afford a new laptop?', expected: 'in_scope' },
  // 7. Travel + affordability
  { intent: '7 travel', message: 'can i go to japan with this budget', expected: 'in_scope' },
  { intent: '7 travel', message: 'Can I travel to Japan with my current savings?', expected: 'in_scope' },
  // 8. Purchase + affordability
  { intent: '8 purchase', message: 'How does buying this laptop affect my budget?', expected: 'in_scope' },
  // 9. Financial what-if
  { intent: '9 what-if', message: 'What if I lose my job next month?', expected: 'in_scope' },
  // 10. Financial education
  { intent: '10 education', message: 'How does compound interest work?', expected: 'in_scope' },
  // 11. Tax / insurance / debt / credit / investing
  { intent: '11 tax-insurance-debt', message: 'Should I invest in mutual funds or pay off my loan first?', expected: 'in_scope' },
  { intent: '11 tax-insurance-debt', message: 'Will my credit score improve if I close my credit card?', expected: 'in_scope' },
  { intent: '11 tax-insurance-debt', message: 'How much tax will I owe this year?', expected: 'in_scope' },
  // 12. Clearly unrelated general knowledge
  { intent: '12 general-knowledge', message: 'What is the Prime Minister of India?', expected: 'out_of_scope' },
  { intent: '12 general-knowledge', message: 'Tell me about Japan.', expected: 'out_of_scope' },
  // 13. Coding
  { intent: '13 coding', message: 'Write Java code.', expected: 'out_of_scope' },
  { intent: '13 coding', message: 'How do I debug a Python algorithm?', expected: 'out_of_scope' },
  // 14. Entertainment
  { intent: '14 entertainment', message: 'Tell me about the cricket match last night.', expected: 'out_of_scope' },
  { intent: '14 entertainment', message: 'Suggest a good movie to watch.', expected: 'out_of_scope' },
  // 15. Science
  { intent: '15 science', message: 'Explain photosynthesis.', expected: 'out_of_scope' },
  { intent: '15 science', message: "What's the weather forecast tomorrow?", expected: 'out_of_scope' },
  // REQUIRED DEMO A — financial question with NO obvious finance keyword
  { intent: 'A no-keyword-financial', message: 'Can I go to Japan with what I have?', expected: 'in_scope' },
  // REQUIRED DEMO B — non-financial subject, financial intent
  { intent: 'B subject-vs-intent', message: 'How much would a Japan trip affect my savings?', expected: 'in_scope' },
  // Ambiguity fails OPEN (safest existing behaviour, no aggressive rejection)
  { intent: 'ambiguous fail-open', message: 'best laptop for students', expected: 'in_scope' },
  { intent: 'ambiguous fail-open', message: 'Is a laptop a good investment?', expected: 'in_scope' },
  // Personal-anchored informational stays in scope
  { intent: 'personal informational', message: 'Tell me about my spending habits.', expected: 'in_scope' },
  // Cross-term safety: entertainment subject + finance words stay in scope
  { intent: 'cross-term safety', message: 'How do movie credits affect a film budget?', expected: 'in_scope' },
];

const lines: string[] = [];
let failures = 0;
for (const test of CASES) {
  const actual = classifyFinancialIntent(test.message);
  const pass = actual === test.expected;
  if (!pass) failures += 1;
  lines.push(
    `${pass ? 'PASS' : 'FAIL'} | ${test.intent} | in="${test.message}" | expected=${test.expected} actual=${actual}`,
  );
}
lines.push(`TOTAL=${CASES.length} FAILURES=${failures}`);
lines.push(failures === 0 ? 'SCOPE CLASSIFIER: ALL CHECKS PASSED' : 'SCOPE CLASSIFIER: FAILURES PRESENT');
fs.rmSync(GENERATED, { force: true });
fs.writeFileSync('scope-test-out.txt', lines.join('\n') + '\n');
console.log(lines.join('\n'));
process.exitCode = failures === 0 ? 0 : 1;

