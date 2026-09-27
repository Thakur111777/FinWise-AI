/**
 * Phase 4D-2 focused verification — dependency-free (Node + esbuild, which is
 * already present as a transitive Vite dependency; package.json untouched).
 *
 * Bundles the pure smartAlertEngine.ts, then checks: R1 threshold behavior,
 * R2 non-empty / empty / insufficient detector behavior, R3 <2 and >=2
 * snapshot behavior, R4 negative net flow + current-period exclusion,
 * duplicate stableKey prevention, run-twice determinism, evidence preservation,
 * and a static scan for AI/network/repository/persistence/advice patterns.
 *
 * Writes: 4d2-verify-report.txt. Exit code 0 = all checks pass.
 */
import { buildSync } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = process.cwd();
const ENGINE_TS = path.join(ROOT, 'src', 'features', 'alerts', 'smartAlertEngine.ts');
const OUT_DIR = path.join(ROOT, '.tmp-4d2');
const OUT_FILE = path.join(OUT_DIR, 'smartAlertEngine.mjs');
const REPORT = path.join(ROOT, '4d2-verify-report.txt');

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail === undefined ? '' : String(detail) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + String(detail).slice(0, 200) : ''}`);
}

/* ---- bundle the pure engine (no new dependency; esbuild ships with Vite) ---- */
mkdirSync(OUT_DIR, { recursive: true });
buildSync({
  entryPoints: [ENGINE_TS],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile: OUT_FILE,
  logLevel: 'silent',
});
const { deriveSmartAlerts, SMART_ALERT_RULE_VERSION } = await import(
  pathToFileURL(OUT_FILE).href + '?t=' + Date.now()
);

/* ------------------------------- fixture helpers ------------------------------- */
const NOW = '2026-09-23T00:00:00.000Z';
const ref = (collection, id) => ({ collection, id });
const ev = (ruleId, ruleVersion, sourceRefs) => ({
  ruleId, ruleVersion, periodKey: 'all', metrics: {}, thresholds: {}, sourceRefs, computedAt: NOW,
});
const sec = (data, evidence) => ({ status: 'available', data, evidence, notes: [] });
const insuf = (code, message, missing) => ({
  status: 'insufficient_data', data: null, evidence: null,
  reasons: [{ code, message, missing }],
});
const base = (over = {}) => ({ computedAt: NOW, currencyCode: 'INR', locale: 'en-IN', ...over });

const BUDGET_EVIDENCE = ev('analytics.budgetUtilization', '4c.3', [
  ref('budgets', 'b1'), ref('transactions', 't1'), ref('budgets', 'b2'), ref('transactions', 't2'),
]);
const overBudget = { budgetId: 'b1', categoryId: 'c1', limit: 5000, spent: 6715, utilizationPercent: 134.3, sourceRefs: [ref('budgets', 'b1'), ref('transactions', 't1')] };
const underBudget = { budgetId: 'b2', categoryId: 'c2', limit: 20000, spent: 16400, utilizationPercent: 82, sourceRefs: [ref('budgets', 'b2'), ref('transactions', 't2')] };
const CATEGORIES = [{ id: 'c1', name: 'Food' }, { id: 'c2', name: 'Transport' }];

const DETECTOR_EVIDENCE = ev('analytics.detectSmallCharges', '4c.4', [ref('transactions', 'tx1')]);
const smallChargesSection = sec([{ merchantLabel: 'TestCoffee', categoryId: 'c2', transactionCount: 3, totalAmount: 180, sourceRefs: [ref('transactions', 'tx1')] }], DETECTOR_EVIDENCE);
const emptyDetectorSection = sec([], DETECTOR_EVIDENCE);
const insufficientDetectorSection = insuf('no_activity', 'Small-charge detection needs expense transactions.', ['transactions']);
const cashSection = sec([{ accountTypeId: 'cash', accountTypeLabel: 'TestCash Wallet', suggestedCashAccountIds: ['a9'], sourceRefs: [ref('accounts', 'a9')] }],
  ev('analytics.detectCashGaps', '4c.4', [ref('accounts', 'a9')]));

const STATE_EVIDENCE = ev('analytics.financialStateChanges', '4c.2', [ref('snapshots', 's1'), ref('snapshots', 's2')]);
const stateTwoPoints = sec([
  { capturedAt: '2026-08-24T10:00:00.000Z', netWorth: 245000, financialHealthScore: 74, safeToSpend: 9100 },
  { capturedAt: '2026-07-25T10:00:00.000Z', netWorth: 240000, financialHealthScore: 68, safeToSpend: 9100 },
], STATE_EVIDENCE);
const stateInsufficient = insuf('no_activity', 'At least two snapshots are required to derive financial state changes.', ['snapshots']);
const stateEqual = sec([
  { capturedAt: '2026-07-25T10:00:00.000Z', netWorth: 240000, financialHealthScore: 68, safeToSpend: 9100 },
  { capturedAt: '2026-08-24T10:00:00.000Z', netWorth: 240000, financialHealthScore: 68, safeToSpend: 9100 },
], STATE_EVIDENCE);

const FLOW_EVIDENCE = ev('analytics.incomeExpenseTrend', '4c.2', [ref('transactions', 'f1')]);
const trendPoint = (key, label, value, refs) => ({ period: { key, label }, value, sourceRefs: refs });
const negativeTrend = sec({
  income: [trendPoint('2026-07', 'Jul', 50000, [ref('transactions', 'f1')]), trendPoint('2026-08', 'Aug', 50000, [ref('transactions', 'f2')]), trendPoint('2026-09', 'Sep', 50000, [])],
  expenses: [trendPoint('2026-08', 'Aug', 52500, [ref('transactions', 'f3')]), trendPoint('2026-07', 'Jul', 47500, []), trendPoint('2026-09', 'Sep', 60000, [])],
}, FLOW_EVIDENCE);

const KEYS = (result) => (result.status === 'available' ? result.data.map((a) => a.stableKey) : []);
const has = (result, key) => KEYS(result).includes(key);

function check(name, run) {
  try {
    const outcome = run();
    record(name, outcome === true, outcome === true ? '' : outcome || 'assertion returned false');
  } catch (error) {
    record(name, false, error instanceof Error ? error.message : error);
  }
}

function input(overrides = {}) {
  return base({
    categories: CATEGORIES,
    budgets: insufficientDetectorSection,
    smallCharges: insufficientDetectorSection,
    cashGaps: insufficientDetectorSection,
    financialState: stateInsufficient,
    cashFlow: insufficientDetectorSection,
    ...overrides,
  });
}

const availableResult = (value) => value.status === 'available' ? value : null;

/* --------------------------- original 15 behavior checks --------------------------- */
check('Rule version and available result contract', () => {
  const result = deriveSmartAlerts(input({ budgets: sec([], BUDGET_EVIDENCE) }));
  return SMART_ALERT_RULE_VERSION === '4d.1' &&
    result.status === 'available' && Array.isArray(result.data) && result.evidence !== null;
});

check('R1 emits one warning when utilization is strictly above 100%', () => {
  const result = deriveSmartAlerts(input({ budgets: sec([overBudget], BUDGET_EVIDENCE) }));
  const alert = availableResult(result)?.data.find((item) => item.stableKey === 'budget_exceeded:b1');
  return !!alert && alert.ruleId === 'budget_exceeded' && alert.severity === 'warning' &&
    alert.title === 'Budget exceeded: Food' && alert.metrics.utilizationPercent === 134.3 &&
    alert.metrics.limit === 5000 && alert.metrics.spent === 6715;
});

check('R1 does not emit an alert at 100% or below', () => {
  const result = deriveSmartAlerts(input({
    budgets: sec([
      { ...overBudget, utilizationPercent: 100, spent: 5000 },
      underBudget,
    ], BUDGET_EVIDENCE),
  }));
  return result.status === 'available' &&
    !has(result, 'budget_exceeded:b1') && !has(result, 'budget_exceeded:b2');
});

check('R2 emits alerts for detected small charges and cash gaps', () => {
  const result = deriveSmartAlerts(input({
    smallCharges: smallChargesSection,
    cashGaps: cashSection,
  }));
  return result.status === 'available' &&
    has(result, 'hidden_spending:small_charges:TestCoffee:c2') &&
    has(result, 'hidden_spending:cash_gap:cash') &&
    result.data.find((item) => item.stableKey === 'hidden_spending:small_charges:TestCoffee:c2')?.metrics.totalAmount === 180;
});

check('R2 available detector sections with empty data emit no alerts', () => {
  const result = deriveSmartAlerts(input({
    smallCharges: emptyDetectorSection,
    cashGaps: sec([], cashSection.evidence),
  }));
  return result.status === 'available' && result.data.length === 0;
});

check('R2 insufficient detector sections emit no alerts and keep insufficient status', () => {
  const result = deriveSmartAlerts(input({
    smallCharges: insufficientDetectorSection,
    cashGaps: insufficientDetectorSection,
  }));
  return result.status === 'insufficient_data' && result.data === null && result.evidence === null;
});

check('R3 fewer than two snapshots emit no state-change alert', () => {
  const onePoint = sec([stateTwoPoints.data[0]], STATE_EVIDENCE);
  const result = deriveSmartAlerts(input({ financialState: onePoint }));
  return result.status === 'available' && !has(result, 'financial_state_change:all');
});

check('R3 two or more snapshots with changed state emit a deterministic state alert', () => {
  const result = deriveSmartAlerts(input({ financialState: stateTwoPoints }));
  const alert = availableResult(result)?.data.find((item) => item.stableKey === 'financial_state_change:all');
  return !!alert && alert.ruleId === 'financial_state_change' &&
    alert.metrics.snapshotCount === 2 && alert.metrics.netWorthFrom === 240000 &&
    alert.metrics.netWorthTo === 245000 && alert.periodKey === 'all';
});

check('R3 equal endpoint snapshots emit no state-change alert', () => {
  const result = deriveSmartAlerts(input({ financialState: stateEqual }));
  return result.status === 'available' && !has(result, 'financial_state_change:all');
});

check('R4 emits a negative-net-flow alert for a completed negative period', () => {
  const result = deriveSmartAlerts(input({ cashFlow: negativeTrend }));
  const alert = availableResult(result)?.data.find((item) => item.stableKey === 'negative_net_flow:2026-08');
  return !!alert && alert.ruleId === 'negative_net_flow' && alert.severity === 'warning' &&
    alert.periodKey === '2026-08' && alert.metrics.income === 50000 &&
    alert.metrics.expenses === 52500 && alert.metrics.netFlow === -2500;
});

check('R4 excludes the in-progress period even when its net flow is negative', () => {
  const result = deriveSmartAlerts(input({ cashFlow: negativeTrend }));
  return result.status === 'available' && !has(result, 'negative_net_flow:2026-09');
});

check('Duplicate stable keys are emitted only once', () => {
  const result = deriveSmartAlerts(input({
    budgets: sec([overBudget, { ...overBudget, spent: 7000 }], BUDGET_EVIDENCE),
  }));
  return result.status === 'available' && KEYS(result).filter((key) => key === 'budget_exceeded:b1').length === 1;
});

check('Running the same input twice gives byte-identical JSON output', () => {
  const fixture = input({
    budgets: sec([overBudget], BUDGET_EVIDENCE),
    smallCharges: smallChargesSection,
    cashGaps: cashSection,
    financialState: stateTwoPoints,
    cashFlow: negativeTrend,
  });
  return JSON.stringify(deriveSmartAlerts(fixture)) === JSON.stringify(deriveSmartAlerts(fixture));
});

check('Each alert reuses its source section evidence object unchanged', () => {
  const fixture = input({
    budgets: sec([overBudget], BUDGET_EVIDENCE),
    smallCharges: smallChargesSection,
    cashGaps: cashSection,
    financialState: stateTwoPoints,
    cashFlow: negativeTrend,
  });
  const result = deriveSmartAlerts(fixture);
  if (result.status !== 'available') return false;
  const expectedEvidence = new Map([
    ['budget_exceeded:b1', BUDGET_EVIDENCE],
    ['hidden_spending:small_charges:TestCoffee:c2', DETECTOR_EVIDENCE],
    ['hidden_spending:cash_gap:cash', cashSection.evidence],
    ['financial_state_change:all', STATE_EVIDENCE],
    ['negative_net_flow:2026-08', FLOW_EVIDENCE],
  ]);
  return [...expectedEvidence].every(([key, evidence]) =>
    result.data.find((alert) => alert.stableKey === key)?.evidence === evidence,
  );
});

check('Static scan finds no AI, network, repository, persistence, or advice behavior', () => {
  const source = readFileSync(ENGINE_TS, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '');
  const forbidden = /\b(?:fetch|XMLHttpRequest|WebSocket|supabase|repository|localStorage|sessionStorage|indexedDB|process\.env|openai|anthropic|gemini|recommend(?:ation)?s?|financial advice)\b|\byou should\b/i;
  return !forbidden.test(source);
});

const passed = results.filter((result) => result.pass).length;
const report = [
  'PHASE 4D-2 SMART ALERT ENGINE VERIFICATION',
  '===========================================',
  `Result: ${passed}/${results.length} checks passed`,
  '',
  ...results.map((result) => `${result.pass ? 'PASS' : 'FAIL'}  ${result.name}${result.detail ? ` — ${result.detail}` : ''}`),
  '',
].join('\n');
writeFileSync(REPORT, report);
console.log(`\n${passed}/${results.length} Phase 4D-2 checks passed`);
if (passed !== 15) process.exitCode = 1;
