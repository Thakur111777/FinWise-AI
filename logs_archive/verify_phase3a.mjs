// TEMPORARY Phase 3A verification script — deleted after the check.
// Cross-checks the EXECUTED migration against the hand-maintained TypeScript
// boundary: database.types.ts row shapes, supabaseRepository.ts select column
// lists, and the default-category seed vs src/config/categories.ts.
import { readFileSync } from 'node:fs';

const migration = readFileSync('supabase/migrations/20260915090000_phase3a_initial_schema.sql', 'utf8');
const typesSrc = readFileSync('src/services/supabase/database.types.ts', 'utf8');
const repoSrc = readFileSync('src/services/supabase/supabaseRepository.ts', 'utf8');
const categoriesSrc = readFileSync('src/config/categories.ts', 'utf8');

let failures = 0;
const fail = (msg) => { failures += 1; console.log(`  FAIL  ${msg}`); };
const pass = (msg) => console.log(`  ok    ${msg}`);

/* 1. Parse migration tables + column names */
const TABLE_CONSTRAINT_KEYWORDS = new Set(['constraint', 'unique', 'primary', 'foreign', 'check', 'exclude', 'like']);
// A real column definition line is `name TYPE ...`. Constraint-body
// continuation lines (e.g. `and to_account_id is not null` inside a multi-line
// CHECK) do not carry a type keyword in the second token and are skipped.
const PG_TYPE_PATTERN =
  /^(uuid|text|varchar|char|character|numeric|decimal|boolean|bool|date|timestamp|timestamptz|time|interval|integer|int|smallint|bigint|serial|bigserial|real|double|money|json|jsonb|bytea)\b/i;
const migrationTables = {};
for (const m of migration.matchAll(/create table if not exists public\.(\w+)\s*\(([\s\S]*?)\n\);/g)) {
  const cols = new Set();
  for (const raw of m[2].split('\n')) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('--')) continue;
    const tokens = line.split(/\s+/);
    if (!/^[a-z_][a-z0-9_]*$/i.test(tokens[0])) continue;
    if (TABLE_CONSTRAINT_KEYWORDS.has(tokens[0].toLowerCase())) continue;
    if (tokens.length < 2 || !PG_TYPE_PATTERN.test(tokens[1])) continue;
    cols.add(tokens[0]);
  }
  migrationTables[m[1]] = cols;
}
console.log(`\n[1] Migration tables parsed: ${Object.keys(migrationTables).length}`);
pass(`tables: ${Object.keys(migrationTables).join(', ')}`);

/* 2. Parse Row interfaces from database.types.ts */
const rowInterfaces = {};
for (const m of typesSrc.matchAll(/export interface (\w+Row) \{([\s\S]*?)\n\}/g)) {
  const props = new Set();
  for (const line of m[2].split('\n')) {
    const pm = line.trim().match(/^([a-z_][a-z0-9_]*)\s*\??:/);
    if (pm) props.add(pm[1]);
  }
  rowInterfaces[m[1]] = props;
}

const TABLE_TO_ROW = {
  profiles: 'ProfileRow',
  accounts: 'AccountRow',
  categories: 'CategoryRow',
  transactions: 'TransactionRow',
  recurring_transactions: 'RecurringTransactionRow',
  budgets: 'BudgetRow',
  goals: 'GoalRow',
  financial_snapshots: 'FinancialSnapshotRow',
  financial_insights: 'FinancialInsightRow',
  life_events: 'LifeEventRow',
  scenarios: 'ScenarioRow',
  decisions: 'DecisionRow',
  financial_memories: 'FinancialMemoryRow',
};

console.log('\n[2] Migration columns vs database.types.ts Row interfaces');
for (const [table, rowName] of Object.entries(TABLE_TO_ROW)) {
  const cols = migrationTables[table];
  const props = rowInterfaces[rowName];
  if (!cols) { fail(`${table}: missing in migration`); continue; }
  if (!props) { fail(`${table}: missing ${rowName}`); continue; }
  const missingInTypes = [...cols].filter((c) => !props.has(c));
  const extraInTypes = [...props].filter((p) => !cols.has(p));
  if (missingInTypes.length === 0 && extraInTypes.length === 0) {
    pass(`${table} <-> ${rowName} (${cols.size} columns identical)`);
  } else {
    if (missingInTypes.length) fail(`${table}: columns missing in ${rowName}: ${missingInTypes.join(', ')}`);
    if (extraInTypes.length) fail(`${table}: ${rowName} has extra props: ${extraInTypes.join(', ')}`);
  }
}

/* 3. Parse COLUMNS select lists from supabaseRepository.ts */
console.log('\n[3] supabaseRepository.ts COLUMNS selects vs Row interfaces');
const columnsBlock = repoSrc.match(/const COLUMNS = \{([\s\S]*?)\} as const;/)?.[1] ?? '';
const repoColumns = {};
for (const m of columnsBlock.matchAll(/(\w+):\s*'([^']*)'/g)) {
  repoColumns[m[1]] = m[2].split(',').map((s) => s.trim()).filter(Boolean);
}
const REPO_TO_ROW = {
  profile: 'ProfileRow',
  accounts: 'AccountRow',
  categories: 'CategoryRow',
  transactions: 'TransactionRow',
  recurringTransactions: 'RecurringTransactionRow',
  budgets: 'BudgetRow',
  goals: 'GoalRow',
};
for (const [key, rowName] of Object.entries(REPO_TO_ROW)) {
  const selected = repoColumns[key];
  const props = rowInterfaces[rowName];
  if (!selected) { fail(`COLUMNS.${key}: missing`); continue; }
  const unknown = selected.filter((c) => !props.has(c));
  const omitted = [...props].filter((p) => !selected.includes(p));
  if (unknown.length === 0 && omitted.length === 0) {
    pass(`COLUMNS.${key} selects every ${rowName} column`);
  } else {
    if (unknown.length) fail(`COLUMNS.${key}: selects unknown columns: ${unknown.join(', ')}`);
    if (omitted.length) fail(`COLUMNS.${key}: omits ${rowName} props: ${omitted.join(', ')}`);
  }
}

/* 4. Default-category seed vs central configuration */
console.log('\n[4] Migration default-category seed vs src/config/categories.ts');
const quoted = (block) => [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
const incomeSeed = quoted(migration.match(/income_names text\[\] := array\[([\s\S]*?)\]/)?.[1] ?? '');
const expenseSeed = quoted(migration.match(/expense_names text\[\] := array\[([\s\S]*?)\]/)?.[1] ?? '');
const incomeCfg = quoted(categoriesSrc.match(/DEFAULT_INCOME_CATEGORY_NAMES = \[([\s\S]*?)\]/)?.[1] ?? '');
const expenseCfg = quoted(categoriesSrc.match(/DEFAULT_EXPENSE_CATEGORY_NAMES = \[([\s\S]*?)\]/)?.[1] ?? '');
const same = (a, b) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');
if (same(incomeSeed, incomeCfg)) pass(`income defaults identical (${incomeSeed.length}): ${incomeSeed.join(', ')}`);
else fail(`income mismatch — seed: [${incomeSeed}] config: [${incomeCfg}]`);
if (same(expenseSeed, expenseCfg)) pass(`expense defaults identical (${expenseSeed.length})`);
else fail(`expense mismatch — seed: [${expenseSeed}] config: [${expenseCfg}]`);

/* Summary */
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exitCode = failures === 0 ? 0 : 1;
