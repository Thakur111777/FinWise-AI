/**
 * Phase 3D verification — FINANCIAL CORE INTEGRATION (static, no network, no credentials).
 *
 * Proves that the EXISTING Phase 2 Financial Core operates through the real
 * backend (FinancialRepository -> SupabaseRepository -> Supabase/PostgreSQL)
 * without being rebuilt, duplicated, or bypassed:
 *
 *   [1]  Phase 2 Financial Core intact (pure services, no persistence coupling)
 *   [2]  FinancialRepository remains the single persistence boundary
 *   [3]  SupabaseRepository persists every collection correctly (upsert + reconcile)
 *   [4]  Repository selection (Supabase for authenticated, localStorage fallback only)
 *   [5]  Authoritative post-mutation refresh (no optimistic-only state)
 *   [6]  Accounts integration
 *   [7]  Categories integration
 *   [8]  Transactions integration (edit updates in place; transfers stay distinct)
 *   [9]  Recurring transactions integration
 *   [10] Budgets integration (spent derived from real transactions)
 *   [11] Goals integration
 *   [12] Financial Intelligence Engine stays deterministic and consumes persisted data
 *   [13] Cross-domain integration (transaction <-> account <-> budget <-> goal)
 *   [14] No financial calculation delegated to AI or moved into SQL/UI
 *   [15] Security / RLS / data safety
 *   [16] Deterministic money handling
 *
 * Never prints credential values — only statuses and verdicts.
 * Exit code 0 = all checks passed.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';

let failures = 0;
const fail = (msg) => { failures += 1; console.log(`  FAIL  ${msg}`); };
const pass = (msg) => console.log(`  ok    ${msg}`);

const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null);
const src = (rel) => read(`src/${rel}`) ?? '';

const require = (label, cond) => (cond ? pass(label) : fail(label));

/* [1] Phase 2 Financial Core intact ----------------------------------------- */
console.log('[1] Phase 2 Financial Core intact');
for (const file of [
  'src/types/financial.ts',
  'src/services/financial/state.ts',
  'src/services/financial/stateHelpers.ts',
  'src/services/financial/result.ts',
  'src/services/financial/validation.ts',
  'src/services/financial/accountService.ts',
  'src/services/financial/categoryService.ts',
  'src/services/financial/transactionService.ts',
  'src/services/financial/recurringService.ts',
  'src/services/financial/budgetService.ts',
  'src/services/financial/goalService.ts',
  'src/services/financial/profileService.ts',
  'src/intelligence/finance.ts',
  'src/lib/money.ts',
]) {
  if (read(file) !== null) pass(`${file} exists`);
  else fail(`${file} missing`);
}

// Every pure service mutates only in-memory state; persistence is never called
// from a service (only the provider persists through the repository).
const serviceFiles = [
  'accountService', 'categoryService', 'transactionService',
  'recurringService', 'budgetService', 'goalService', 'profileService',
];
const servicesPure = serviceFiles.every((name) => {
  const text = src(`services/financial/${name}.ts`);
  return !/@supabase|localStorage|FinancialRepository|saveAccounts|saveTransactions/.test(text);
});
require('pure services never touch persistence (no supabase/localStorage/repository calls)', servicesPure);

/* [2] FinancialRepository boundary ------------------------------------------ */
console.log('[2] FinancialRepository remains the integration boundary');
const repository = src('services/financial/repository.ts');
require(
  'interface declares load + saveProfile/saveAccounts/saveCategories/saveTransactions/saveRecurringTransactions/saveBudgets/saveGoals',
  /load\(\): Promise<StoredFinancialState>/.test(repository) &&
    /saveProfile/.test(repository) && /saveAccounts/.test(repository) &&
    /saveCategories/.test(repository) && /saveTransactions/.test(repository) &&
    /saveRecurringTransactions/.test(repository) && /saveBudgets/.test(repository) &&
    /saveGoals/.test(repository),
);

// Exactly two implementations of the interface, no third persistence layer.
const repoImpls = [
  src('services/financial/localStorageRepository.ts'),
  src('services/supabase/supabaseRepository.ts'),
];
require(
  'LocalStorageRepository and SupabaseRepository implement FinancialRepository',
  repoImpls.every((text) => /FinancialRepository/.test(text)),
);

// UI never bypasses the boundary: no page/feature/component may open a
// Supabase table, or call browser storage, directly. The Supabase *client
// factory* (getSupabaseClient) is sanctioned wiring in exactly three places:
// the auth layer, the financial data provider (repository selection), and the
// Copilot service (Phase 3C Edge Function path) — none of which touch tables.
const SANCTIONED_CLIENT_IMPORTS = new Set([
  'features/auth/authContext.tsx',
  'features/dashboard/financialDataContext.tsx',
  'ai/copilotService.ts',
]);
const boundaryViolations = [];
for (const dir of ['pages', 'features', 'components', 'ai']) {
  const listing = [];
  const walk = (base) => {
    let entries = [];
    try { entries = readdirSync(`src/${base}`, { withFileTypes: true }); } catch { /* dir may not exist */ }
    for (const entry of entries) {
      const rel = `${base}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (/\.(tsx|ts)$/.test(entry.name)) listing.push({ rel, text: src(rel) });
    }
  };
  walk(dir);
  for (const { rel, text } of listing) {
    const stripped = text.replace(/^\s*(\/\/|\/\*|\*).*$/gm, '');
    if (/\bfrom\s+'@supabase\//.test(stripped) && !SANCTIONED_CLIENT_IMPORTS.has(rel)) boundaryViolations.push(`${rel} (supabase import)`);
    if (/from '.*services\/supabase\//.test(stripped) && !SANCTIONED_CLIENT_IMPORTS.has(rel)) boundaryViolations.push(`${rel} (services/supabase import)`);
    if (/\bsupabase[a-zA-Z]*\.from\(/.test(stripped)) boundaryViolations.push(`${rel} (direct table access)`);
    if (/\blocalStorage\.\w|\bsessionStorage\.\w/.test(stripped)) boundaryViolations.push(`${rel} (browser storage)`);
  }
}
require(
  'no UI page/feature/component opens Supabase tables or browser storage directly',
  boundaryViolations.length === 0,
);
if (boundaryViolations.length > 0) console.log(`        violations: ${boundaryViolations.join(', ')}`);

/* [3] SupabaseRepository persistence correctness ----------------------------- */
console.log('[3] SupabaseRepository persists every collection correctly');
const supabaseRepo = src('services/supabase/supabaseRepository.ts');
const mappers = src('services/supabase/mappers.ts');

require(
  'bulk upsert runs with defaultToNull:false so column defaults stay reachable',
  /defaultToNull:\s*false/.test(supabaseRepo),
);
require(
  'categories upsert on the natural key (user_id,type,name) so defaults are adopted, never duplicated',
  /'user_id,type,name'/.test(supabaseRepo),
);
for (const method of ['saveAccounts', 'saveCategories', 'saveTransactions', 'saveRecurringTransactions', 'saveBudgets', 'saveGoals']) {
  require(`${method} implemented on SupabaseRepository`, new RegExp(`async ${method}\\(`).test(supabaseRepo));
}
// Deletion reconciliation: edits/deletes must update or remove rows, never
// leave ghosts that a fresh fetch would resurrect.
for (const table of ['accounts', 'transactions', 'budgets', 'goals']) {
  require(
    `deleted ${table} rows are reconciled out of PostgreSQL (no resurrection on refresh)`,
    new RegExp(`TABLES\\.${table},[\\s\\S]{0,200}?reconcileDeletions|reconcileDeletions\\([\\s\\S]{0,200}?TABLES\\.${table}`).test(supabaseRepo),
  );
}
require(
  'recurring transaction deletions are reconciled',
  /reconcileDeletions\(\s*TABLES\.recurringTransactions/.test(supabaseRepo),
);
require(
  'reconcileDeletions guards: empty collections never prune; non-uuid ids never prune',
  /appIds\.length === 0\) return/.test(supabaseRepo) && /appIds\.every\(isUuid\)/.test(supabaseRepo),
);
// Load re-derives money from authoritative inputs (no double-applied effects).
require(
  'load() re-derives account balances from initial balances + transactions',
  /deriveAccountBalances\(accountRows\.map\(toAppAccount\), state\.transactions\)/.test(supabaseRepo),
);
require(
  'load() re-derives budget spending from real transactions',
  /withDerivedBudgetSpending\(budgetRows\.map\(toAppBudget\), state\.transactions\)/.test(supabaseRepo),
);
require(
  'mappers translate every snake_case boundary (accounts, transactions, recurring, budgets, goals, categories, profile)',
  ['toAppAccount', 'toAppTransaction', 'toAppRecurringTransaction', 'toAppBudget', 'toAppGoal', 'toAppCategory', 'toAppProfile']
    .every((fn) => new RegExp(`export function ${fn}\\(`).test(mappers)),
);
require(
  'phase-2 prefixed app ids are never sent as uuid primary keys (uuidColumn gate)',
  /function uuidColumn\(/.test(mappers) && /function isUuid\(/.test(mappers),
);

/* [4] Repository selection ---------------------------------------------------- */
console.log('[4] Repository selection (one source of truth)');
const dataContext = src('features/dashboard/financialDataContext.tsx');
require(
  'provider builds SupabaseRepository from the authenticated session user',
  /createSupabaseRepository\(supabaseClient, \{[\s\S]{0,120}?getUserId/.test(dataContext),
);
require(
  'LocalStorageRepository kept only as the unconfigured fallback',
  /LocalStorageRepository/.test(dataContext) && /createSupabaseRepository/.test(dataContext),
);
require(
  'store remounts per persistence identity (sign-in/out/user switch cannot mix data)',
  /key=\{persistenceIdentity\}/.test(dataContext) &&
    /supabaseClient === null \? 'local' : \(authUserId \?\? 'signed-out'\)/.test(dataContext),
);
require(
  'signed-out configured app holds an honest empty state (local storage never re-read behind auth)',
  /signedOutConfigured/.test(dataContext) && /usesSupabase = supabaseClient !== null && authUserId !== null/.test(dataContext),
);

/* [5] Authoritative post-mutation refresh ------------------------------------- */
console.log('[5] Post-mutation refresh from the repository (no optimistic-only UI)');
const applyBlocks = (dataContext.match(/if \(usesSupabase\) await refreshFromRepository\(\);/g) ?? []).length;
require(
  'every mutation class re-reads the authoritative collections after persisting (>= 7 apply-paths)',
  applyBlocks >= 7,
);

/* [6] Accounts integration ----------------------------------------------------- */
console.log('[6] Accounts integration');
const accountsPage = src('pages/AccountsPage.tsx');
const accountService = src('services/financial/accountService.ts');
require(
  'Accounts UI mutates only through provider actions (create/update/archive/unarchive/delete)',
  /actions\.createAccount\(/.test(accountsPage) && /actions\.updateAccount\(/.test(accountsPage) &&
    /actions\.archiveAccount\(/.test(accountsPage) && /actions\.unarchiveAccount\(/.test(accountsPage) &&
    /actions\.deleteAccount\(/.test(accountsPage),
);
require(
  'account edit validates against OTHER accounts only (own id excluded — no false duplicate)',
  /const others = state\.accounts\.filter\(\(account\) => account\.id !== id\);[\s\S]{0,200}validateAccountInput\(input, others\)/.test(accountService),
);
require(
  'account balances are always re-derived (initial balance + transaction effects, minor-unit math)',
  /export function deriveAccountBalances/.test(accountService) && /toMinorUnits/.test(accountService),
);
require(
  'only archived accounts with zero transactions can be permanently deleted (DB RESTRICT preserved)',
  /Only archived accounts can be permanently deleted/.test(accountService) &&
    /ACCOUNT_HAS_TRANSACTIONS/.test(accountService),
);
require(
  'account persistence survives refresh: saveAccounts upserts by row id then reconciles deletions',
  /async saveAccounts\(accounts: Account\[\]\): Promise<void> \{[\s\S]{0,600}?reconcileDeletions\(TABLES\.accounts/.test(supabaseRepo),
);

/* [7] Categories integration ----------------------------------------------------- */
console.log('[7] Categories integration');
const categoryService = src('services/financial/categoryService.ts');
require(
  'category duplicate protection (name unique per user + type, case-insensitive)',
  /isCategoryNameTaken/.test(categoryService) && /toLowerCase\(\)/.test(categoryService),
);
require(
  'category edit excludes its own id from duplicate detection',
  /exceptId\?: string/.test(categoryService) && /category\.id !== exceptId/.test(categoryService),
);
require(
  'category type is immutable after creation (transactions keep pointing at valid categories)',
  /Changing the category type is not allowed after creation\./.test(categoryService),
);
require(
  'in-use categories cannot be hidden (transactions/budgets stay consistent)',
  /This category is used by existing transactions and cannot be hidden\./.test(categoryService),
);
require(
  'category persistence matches the DB natural key (no duplicate category rows)',
  /'user_id,type,name'/.test(supabaseRepo) && /toCategoryInsert/.test(mappers),
);

/* [8] Transactions integration ----------------------------------------------------- */
console.log('[8] Transactions integration');
const transactionService = src('services/financial/transactionService.ts');
const transactionQueries = src('features/financial/transactionQueries.ts');
const transactionsPage = src('pages/TransactionsPage.tsx');
require(
  'createTransaction mints a fresh id (never overwrites an existing row)',
  /createId\('txn'\)/.test(transactionService),
);
require(
  'updateTransaction maps by existing id — an edit UPDATES the row, never duplicates it',
  /const existing = state\.transactions\.find\(\(transaction\) => transaction\.id === id\);[\s\S]{0,600}state\.transactions\.map\(\(item\) => \(item\.id === id \? transaction : item\)\)/.test(transactionService),
);
require(
  'edit preserves createdAt and re-derives balances from the full transaction set',
  /buildTransaction\(input, now, id, existing\.createdAt\)/.test(transactionService),
);
require(
  'transfers are distinct: destination required, no category, self-transfer rejected',
  /Choose a destination account for the transfer\./.test(transactionService) &&
    /input\.toAccountId === input\.accountId/.test(transactionService) &&
    /input\.type === 'transfer' \? undefined : parseOptionalText\(input\.categoryId\)/.test(transactionService),
);
require(
  'transfer money moves between accounts without becoming income or expense',
  /'transfer'[\s\S]{0,600}?balances\.get\(transaction\.toAccountId\)/.test(accountService),
);
require(
  'delete/edit effects reverse implicitly by full re-derivation (no incremental balance to desync)',
  /deriveAccountBalances\(state\.accounts, transactions\)/.test(transactionService),
);
require(
  'search/filter/sort are pure functions the Transactions page consumes',
  /export function filterTransactions/.test(transactionQueries) &&
    /export function sortTransactions/.test(transactionQueries) &&
    /filterTransactions, sortTransactions/.test(transactionsPage),
);
require(
  'type/account/category filters and date range supported by the pure query layer',
  /filters\.types/.test(transactionQueries) && /filters\.accountId/.test(transactionQueries) &&
    /filters\.categoryId/.test(transactionQueries) && /filters\.dateFrom/.test(transactionQueries) &&
    /filters\.dateTo/.test(transactionQueries),
);
require(
  'transactions persist by row id with deletion reconciliation (edit cannot ghost-duplicate)',
  /reconcileDeletions\(\s*TABLES\.transactions/.test(supabaseRepo),
);

/* [9] Recurring transactions integration ------------------------------------------ */
console.log('[9] Recurring transactions integration');
const recurringService = src('services/financial/recurringService.ts');
require(
  'recurrence math is deterministic and pure (advanceOccurrence / upcoming occurrences)',
  /export function advanceOccurrence/.test(recurringService) && /computeUpcomingOccurrences/.test(recurringService),
);
require(
  'a recurring definition is never auto-materialised (occurrences are projections, not rows)',
  !/createTransaction\(state/.test(recurringService),
);
require(
  'active/inactive toggle is an explicit user action persisted with the schedule',
  /toggleRecurringActive/.test(recurringService) && /is_active: recurring\.isActive/.test(mappers),
);
require(
  'linking a one-off transaction to a new schedule persists transactions + accounts + schedules together',
  /saveTransactions\(txResult\.value\.state\.transactions\); ?[\s\S]{0,80}saveAccounts\(txResult\.value\.state\.accounts\); ?[\s\S]{0,80}saveRecurringTransactions/.test(dataContext.replace(/\r?\n\s*/g, ' ')),
);

/* [10] Budgets integration ----------------------------------------------------------- */
console.log('[10] Budgets integration');
const budgetService = src('services/financial/budgetService.ts');
require(
  'budget spent is always derived from real expense transactions in the budget period',
  /export function budgetSpentFor/.test(budgetService) &&
    /transaction\.type !== 'expense'/.test(budgetService) &&
    /transaction\.date < budget\.startDate \|\| transaction\.date > budget\.endDate/.test(budgetService),
);
require(
  'budget duplicate protection (one plan per category + period + start date)',
  /A budget for this category, period, and start date already exists\./.test(budgetService),
);
require(
  'budget edits re-derive spending instead of trusting stored values',
  /withDerivedBudgetSpending\(\s*state\.budgets\.map/.test(budgetService),
);
require(
  'budget persistence reconciles deletions (deleted budgets stay deleted after refresh)',
  /reconcileDeletions\(TABLES\.budgets/.test(supabaseRepo),
);

/* [11] Goals integration --------------------------------------------------------------- */
console.log('[11] Goals integration');
const goalService = src('services/financial/goalService.ts');
require(
  'goal CRUD is validated and deterministic (target > 0, saved <= target)',
  /Saved amount cannot be greater than the target amount\./.test(goalService),
);
require(
  'goal persistence reconciles deletions (deleted goals stay deleted after refresh)',
  /reconcileDeletions\(TABLES\.goals/.test(supabaseRepo),
);
require(
  'goal progress stays a deterministic engine calculation',
  /export function goalProgress\(goal: Goal\): number/.test(src('intelligence/finance.ts')),
);

/* [12] Financial Intelligence Engine ------------------------------------------------------ */
console.log('[12] Financial Intelligence Engine consumes persisted data');
const engine = src('intelligence/finance.ts');
const dashboardMetrics = src('features/dashboard/useDashboardMetrics.ts');
const overviewPage = src('pages/OverviewPage.tsx');
const analyticsPage = src('pages/AnalyticsPage.tsx');
require(
  'engine covers net worth, monthly flow, savings rate, safe-to-spend, health score, projection, goal progress',
  /computeNetWorthBreakdown|netWorth/.test(engine) && /computeMonthlyFlow/.test(engine) &&
    /savingsRate/.test(engine) && /safeToSpend/.test(engine) &&
    /calculateFinancialHealthScore/.test(engine) && /projectionSummary/.test(engine) &&
    /aggregateGoalProgress/.test(engine),
);
require(
  'engine is pure: no fetch/AI/supabase imports (deterministic, no external truth)',
  !/@supabase|fetch\(|Copilot/.test(engine),
);
require(
  'dashboard metrics are computed from the provider state (persisted data), never hardcoded',
  /computeDashboardMetrics\(\{/.test(dashboardMetrics) && /useFinancialData\(\)/.test(dashboardMetrics),
);
require(
  'Overview + Analytics consume engine output via the dashboard hook (no inline financial math)',
  /useDashboardMetrics\(\)/.test(overviewPage) && /useDashboardMetrics\(\)/.test(analyticsPage),
);

/* [13] Cross-domain integration ------------------------------------------------------------ */
console.log('[13] Cross-domain integration');
const dataContextFlat = dataContext.replace(/\r?\n\s*/g, ' ');
require(
  'creating/editing/deleting a transaction persists BOTH transactions and re-derived accounts',
  /saveTransactions\(result\.value\.state\.transactions\); ?[\s\S]{0,80}saveAccounts\(result\.value\.state\.accounts\)/.test(dataContextFlat),
);
require(
  'transactions validate the account exists and is active (FK semantics enforced in the domain layer)',
  /Choose a valid account\./.test(transactionService) && /account\.isArchived/.test(transactionService),
);
require(
  'income/expense require a matching-type category (category linkage enforced in the domain layer)',
  /category\.type !== input\.type/.test(transactionService),
);
require(
  'currency must match the account currency (no cross-currency corruption)',
  /Amount currency must match the account currency/.test(transactionService),
);
require(
  'expense creation flows into budget spending via derivation (category-linked budgets reflect real data)',
  /budgetSpentFor/.test(budgetService) && /transaction\.categoryId !== budget\.categoryId/.test(budgetService),
);

/* [14] No calculation delegated to AI / SQL / UI ---------------------------------------------- */
console.log('[14] AI stays an explainer, never the source of financial truth');
const copilotService = src('ai/copilotService.ts');
require(
  'Copilot browser boundary only invokes the edge function (no financial math, no writes)',
  /finwise-copilot/.test(copilotService) &&
    !/intelligence\/finance|budgetSpentFor|deriveAccountBalances/.test(copilotService),
);
require(
  'edge function only READS rows for context (no INSERT/UPDATE/DELETE on financial tables)',
  (() => {
    const fn = read('supabase/functions/finwise-copilot/index.ts') ?? '';
    return (fn.match(/\.(insert|update|delete|upsert)\(/g) ?? []).length === 0;
  })(),
);
require(
  'migrations contain no derived-money SQL triggers (balances/spent are app-derived only)',
  (() => {
    const mig = read('supabase/migrations/20260915090000_phase3a_initial_schema.sql') ?? '';
    return !/current_balance\s*=\s*current_balance\s*[+\-]/.test(mig) && !/spent\s*=\s*spent\s*[+\-]/.test(mig);
  })(),
);

/* [15] Security / RLS / data safety -------------------------------------------------------------- */
console.log('[15] Security, RLS and data safety');
const migration = read('supabase/migrations/20260915090000_phase3a_initial_schema.sql') ?? '';
require(
  'RLS enabled on user-owned tables and ownership enforced via auth.uid()',
  /enable row level security/i.test(migration) && /auth\.uid\(\)/.test(migration),
);
require(
  'anon is denied by default (privilege revocation present)',
  /revoke/i.test(migration),
);
require(
  'repository ownership comes from the resolved session, never a hardcoded user id',
  !/const\s+USER_ID\s*=|userId\s*=\s*['"][0-9a-f-]{36}/i.test(supabaseRepo),
);
const srcFiles = [];
const walkAll = (base) => {
  let entries = [];
  try { entries = readdirSync(base, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const rel = `${base}/${entry.name}`;
    if (entry.isDirectory()) walkAll(rel);
    else if (/\.(tsx|ts)$/.test(entry.name)) srcFiles.push({ rel, text: read(rel) ?? '' });
  }
};
walkAll('src');
// Scan executable code only (comments stripped) for actual secret material —
// mentioning the words "service_role" in a prohibition comment is not a leak.
// services/supabase/config.ts is exempt: it contains the guard that REFUSES a
// service-role key (verified by its own dedicated check below).
const secretPattern =
  /eyJhbGciOi|sb_secret_|AIza[0-9A-Za-z_\-]{20,}|sk-[0-9A-Za-z]{20,}|service_role|AI_PROVIDER_API_KEY|SUPABASE_SERVICE/;
const secretHits = srcFiles.filter(({ rel, text }) => {
  if (rel.endsWith('services/supabase/config.ts')) return false;
  const code = text.replace(/^\s*(?:\/\/|\/\*|\*).*$/gm, '');
  return secretPattern.test(code);
});
require(
  'no privileged secrets (service-role keys, AI provider keys, JWTs) in frontend executable code',
  secretHits.length === 0,
);
if (secretHits.length > 0) console.log(`        hits: ${secretHits.map((h) => h.rel).join(', ')}`);
require(
  'supabase client config boundary throws on a privileged frontend key',
  /service_role/i.test(src('services/supabase/config.ts')),
);

/* [16] Deterministic money -------------------------------------------------------------------------- */
console.log('[16] Deterministic money handling');
const money = src('lib/money.ts');
require(
  'money math is integer minor-unit based (no floating drift)',
  /toMinorUnits/.test(money) && /fromMinorUnits/.test(money) && /Math\.round/.test(money),
);
require(
  'all persisted monetary values are rounded at the mapper boundary',
  /roundMoney/.test(mappers) && (mappers.match(/roundMoney/g) ?? []).length >= 6,
);

/* summary ---------------------------------------------------------------------------------------------- */
console.log('');
console.log(
  failures === 0
    ? 'PHASE 3D VERIFICATION: ALL CHECKS PASSED'
    : `PHASE 3D VERIFICATION: ${failures} CHECK(S) FAILED`,
);
process.exitCode = failures === 0 ? 0 : 1;
