/** Focused Phase 4D-3 persistence verification using the existing repository contract. */
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, '.tmp-4d3');
const OUT_FILE = path.join(OUT_DIR, 'smartAlertPersistence.mjs');
const REPORT = path.join(ROOT, '4d3-verify-report.txt');
mkdirSync(OUT_DIR, { recursive: true });
buildSync({
  entryPoints: [path.join(ROOT, 'src/services/financial/smartAlertPersistence.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile: OUT_FILE,
  logLevel: 'silent',
});
const {
  dismissPersistedSmartAlert,
  SMART_ALERT_FINGERPRINT_PREFIX,
  smartAlertFingerprint,
  syncSmartAlerts,
} = await import(`${pathToFileURL(OUT_FILE).href}?t=${Date.now()}`);

const evidence = {
  ruleId: 'analytics.test',
  ruleVersion: '4c.1',
  periodKey: '2026-08',
  metrics: { amount: 25 },
  thresholds: { limit: 20 },
  sourceRefs: [{ collection: 'transactions', id: 'tx1' }],
  computedAt: '2026-09-25T00:00:00.000Z',
};
const alert = (overrides = {}) => ({
  stableKey: 'budget_exceeded:b1',
  ruleId: 'budget_exceeded',
  severity: 'warning',
  title: 'Budget exceeded: Food',
  explanation: 'Recorded spending exceeded the budget.',
  periodKey: '2026-08',
  metrics: { utilizationPercent: 125, limit: 100, spent: 125 },
  evidence,
  ...overrides,
});
const available = (data) => ({ status: 'available', data, evidence, notes: [] });
const insufficient = {
  status: 'insufficient_data',
  data: null,
  evidence: null,
  reasons: [{ code: 'no_activity', message: 'Not enough data.', missing: ['transactions'] }],
};

class MemoryRepository {
  rows = [];
  reads = 0;
  nextId = 1;

  async loadInsights(limit) {
    this.reads += 1;
    assert.ok(limit > 0 && limit <= 500, 'insight lookup stays bounded');
    return this.rows.slice(0, limit);
  }
  async saveInsight(insight) {
    this.rows.push({ ...insight, id: `insight-${this.nextId++}`, userId: 'test-user', createdAt: '2026-09-25T00:00:00.000Z' });
  }
  async updateInsight(id, patch) {
    this.rows = this.rows.map((row) => row.id === id ? { ...row, ...patch } : row);
  }
  async deleteInsight(id) {
    this.rows = this.rows.filter((row) => row.id !== id);
  }
  async loadSnapshots() { return []; }
  async saveSnapshot() {}
}

const results = [];
async function check(name, run) {
  try {
    await run();
    results.push({ name, pass: true });
  } catch (error) {
    results.push({ name, pass: false, detail: error instanceof Error ? error.message : String(error) });
  }
}

await check('fingerprint includes stable key and period', async () => {
  assert.equal(smartAlertFingerprint(alert()), `${SMART_ALERT_FINGERPRINT_PREFIX}budget_exceeded%3Ab1:2026-08`);
  assert.notEqual(smartAlertFingerprint(alert()), smartAlertFingerprint(alert({ periodKey: '2026-09' })));
});

await check('engine alert maps into the existing financial_insights row shape', async () => {
  const repository = new MemoryRepository();
  const result = await syncSmartAlerts(repository, available([alert()]));
  assert.deepEqual(result, { status: 'synced', inserted: 1, updated: 0, unchanged: 0, dismissed: 0 });
  const [row] = repository.rows;
  assert.equal(row.type, 'alert');
  assert.equal(row.title, alert().title);
  assert.equal(row.summary, alert().explanation);
  assert.equal(row.confidence, 1);
  assert.equal(row.category, smartAlertFingerprint(alert()));
});

await check('stable key, period, metrics and evidence survive details round-trip', async () => {
  const repository = new MemoryRepository();
  await syncSmartAlerts(repository, available([alert()]));
  const stored = JSON.parse(repository.rows[0].details);
  assert.equal(stored.stableKey, alert().stableKey);
  assert.equal(stored.periodKey, alert().periodKey);
  assert.deepEqual(stored.metrics, alert().metrics);
  assert.deepEqual(stored.evidence, evidence);
  assert.equal(stored.status, 'active');
});

await check('repeated sync is idempotent for one user fingerprint', async () => {
  const repository = new MemoryRepository();
  await syncSmartAlerts(repository, available([alert()]));
  const second = await syncSmartAlerts(repository, available([alert()]));
  assert.equal(repository.rows.length, 1);
  assert.equal(second.unchanged, 1);
  assert.equal(second.inserted, 0);
});

await check('duplicate fingerprints within one generated batch write once', async () => {
  const repository = new MemoryRepository();
  const result = await syncSmartAlerts(repository, available([alert(), alert({ title: 'duplicate' })]));
  assert.equal(repository.rows.length, 1);
  assert.equal(result.inserted, 1);
});

await check('a changed active alert updates its existing row', async () => {
  const repository = new MemoryRepository();
  await syncSmartAlerts(repository, available([alert()]));
  const id = repository.rows[0].id;
  const next = alert({ explanation: 'Recorded spending increased again.' });
  const result = await syncSmartAlerts(repository, available([next]));
  assert.equal(repository.rows.length, 1);
  assert.equal(repository.rows[0].id, id);
  assert.equal(repository.rows[0].summary, next.explanation);
  assert.equal(result.updated, 1);
});

await check('different periods persist as separate fingerprints', async () => {
  const repository = new MemoryRepository();
  await syncSmartAlerts(repository, available([alert(), alert({ periodKey: '2026-09' })]));
  assert.equal(repository.rows.length, 2);
  assert.notEqual(repository.rows[0].category, repository.rows[1].category);
});

await check('insufficient data does not read or write persistence', async () => {
  const repository = new MemoryRepository();
  const result = await syncSmartAlerts(repository, insufficient);
  assert.equal(result.status, 'insufficient_data');
  assert.equal(repository.reads, 0);
  assert.equal(repository.rows.length, 0);
});

await check('dismissal uses the existing details field and is retained on next sync', async () => {
  const repository = new MemoryRepository();
  await syncSmartAlerts(repository, available([alert()]));
  assert.equal(await dismissPersistedSmartAlert(repository, repository.rows[0]), true);
  const result = await syncSmartAlerts(repository, available([alert({ explanation: 'Changed evidence summary.' })]));
  assert.equal(repository.rows.length, 1);
  assert.equal(JSON.parse(repository.rows[0].details).status, 'dismissed');
  assert.equal(result.dismissed, 1);
});

await check('ordinary financial insights are not dismissible as smart alerts', async () => {
  const repository = new MemoryRepository();
  const ordinary = { id: 'ordinary', type: 'optimization', category: 'savings', details: '{}' };
  assert.equal(await dismissPersistedSmartAlert(repository, ordinary), false);
  assert.equal(repository.rows.length, 0);
});

await check('persistence uses repository boundary and has no direct storage or network access', async () => {
  const source = readFileSync(path.join(ROOT, 'src/services/financial/smartAlertPersistence.ts'), 'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(|supabase|localStorage|sessionStorage|indexedDB/i);
  assert.match(source, /repository\.(?:loadInsights|saveInsight|updateInsight)/);
});

const passed = results.filter((result) => result.pass).length;
const report = [
  'PHASE 4D-3 SMART ALERT PERSISTENCE VERIFICATION',
  '===============================================',
  `Result: ${passed}/${results.length} checks passed`,
  '',
  ...results.map((result) => `${result.pass ? 'PASS' : 'FAIL'}  ${result.name}${result.detail ? ` — ${result.detail}` : ''}`),
  '',
].join('\n');
writeFileSync(REPORT, report);
for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'}  ${result.name}${result.detail ? ` — ${result.detail}` : ''}`);
console.log(`\n${passed}/${results.length} Phase 4D-3 checks passed`);
if (passed !== results.length) process.exitCode = 1;
