/* Phase 4B manual functional test — headless Edge + CDP (no new packages).
 * Runs against a LOCAL-MODE dev server (Supabase unconfigured) on :5199.
 * Seeds a small clearly-labelled test dataset into the BROWSER's localStorage
 * only. Never touches the network, the Supabase project, or app source.
 * Writes: p4b-manual-results.json, p4b-manual-report.txt, screenshots.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');

const APP = 'http://127.0.0.1:5199';
const APP_HOST = '127.0.0.1:5199';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 5199;
const results = [];
const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
const allRequests = [];
const dumps = {};

function record(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail === undefined ? '' : String(detail) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + String(detail).slice(0, 200) : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- CDP client */
class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = []; }
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const client = new Cdp(ws);
      // Incoming CDP frames MUST be dispatched into handle(), otherwise every
      // send() promise times out (this was the "CDP timeout: Page.enable" bug).
      ws.onmessage = (ev) => {
        try { client.handle(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch { /* ignore malformed frame */ }
      };
      ws.onopen = () => resolve(client);
      ws.onerror = () => reject(new Error('WS error: ' + url));
    });
  }
  on(fn) { this.listeners.push(fn); }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('CDP timeout: ' + method)); } }, 20000);
    });
  }
  handle(raw) {
    const msg = JSON.parse(raw);
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id); this.pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    } else if (msg.method) { for (const fn of this.listeners) fn(msg); }
  }
}

/* -------------------------------------------------- dev server / browser mgmt */
function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port, timeout: 1500 });
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.on('timeout', () => { s.destroy(); resolve(false); });
  });
}
/* Starts the Vite dev server in LOCAL MODE (Supabase env blanked) if not already
 * listening. Returns { child } when this script owns the server, else { child: null }.
 * No app source is modified; env vars are process-scoped only. */
async function ensureDevServer(logPath) {
  if (await portOpen(PORT)) return { child: null, owned: false };
  const out = fs.openSync(logPath, 'w');
  const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
    cwd: __dirname,
    stdio: ['ignore', out, out],
    env: { ...process.env, VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' },
    windowsHide: true,
  });
  const start = Date.now();
  while (Date.now() - start < 90000) {
    if (await portOpen(PORT)) return { child, owned: true };
    if (child.exitCode !== null) throw new Error('vite exited early (code ' + child.exitCode + '); see ' + logPath);
    await sleep(500);
  }
  throw new Error('vite did not open :' + PORT + ' within 90s; see ' + logPath);
}
/* Kills ONLY headless Edge instances started by THIS harness (matched by the
 * unique temp profile dir on their command line). The user's own Edge windows
 * are never touched. */
function killOwnBrowsers(profileDir) {
  if (!profileDir) return;
  try {
    const ps = 'Get-CimInstance Win32_Process -Filter "Name=\'msedge.exe\'" | '
      + 'Where-Object { $_.CommandLine -like \'*' + profileDir.replace(/'/g, "''") + '*\' } | '
      + 'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }';
    spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'ignore', windowsHide: true, timeout: 20000 });
  } catch { /* best effort */ }
}
/* Finds a free TCP port for the CDP endpoint (avoids clashing with leftovers). */
async function freePort(from) {
  for (let p = from; p < from + 40; p++) { if (!(await portOpen(p))) return p; }
  throw new Error('no free CDP port found');
}

/* ------------------------------------------- T8 security: static source scan */
/* The Phase 4B source set (never Phase 3 files, never Copilot/AI sources). */
function phase4bSourceFiles() {
  const out = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(p);
    }
  };
  walk(path.join(__dirname, 'src', 'intelligence'));
  walk(path.join(__dirname, 'src', 'features', 'intelligence'));
  for (const rel of [
    'src\\types\\intelligence.ts',
    'src\\pages\\DigitalTwinPage.tsx',
    'src\\services\\financial\\intelligenceRepository.ts',
    'src\\services\\financial\\intelligenceRepositoryFactory.ts',
    'src\\services\\financial\\localStorageIntelligenceRepository.ts',
    'src\\services\\supabase\\supabaseIntelligenceRepository.ts',
  ]) {
    const p = path.join(__dirname, rel);
    if (fs.existsSync(p)) out.push(p);
  }
  return out;
}
/* The pure derivation modules that must stay deterministic (no I/O at all).
 * `src/features/intelligence` legitimately imports the repository factory, so it
 * is deliberately excluded here and covered by the AI/network-token scan. */
function pureDerivationFiles() {
  return phase4bSourceFiles().filter(
    (p) => /[\\/]src[\\/]intelligence[\\/]/.test(p) || /[\\/]types[\\/]intelligence\.ts$/.test(p),
  );
}
function scanForPattern(files, re) {
  const hits = [];
  for (const f of files) {
    const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) hits.push(path.relative(__dirname, f) + ':' + (i + 1) + ' ' + lines[i].trim().slice(0, 120));
    }
  }
  return hits;
}

async function poll(fn, timeoutMs, label) {
  const start = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* retry */ }
    if (Date.now() - start > timeoutMs) throw new Error('timeout waiting for ' + label);
    await new Promise((r) => setTimeout(r, 400));
  }
}
/* ------------------------------------------------------------------- seed db */
function iso(d) { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
function buildSeed() {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const dThis = (day) => iso(new Date(y, m, day));
  const dPrev = (day) => iso(new Date(y, m - 1, day));
  const firstThis = iso(new Date(y, m, 1));
  const lastThis = iso(new Date(y, m + 1, 0));
  const firstNext = iso(new Date(y, m + 1, 1));
  const isoTime = (date) => new Date(date + 'T10:00:00').toISOString();
  const t = (id, accountId, type, amount, categoryId, date, merchant, toAccountId) => ({
    id, accountId, toAccountId, type, amount, currencyCode: 'INR', categoryId, merchant,
    description: 'Phase4B manual test data', date, isRecurring: false,
    createdAt: isoTime(date), updatedAt: isoTime(date),
  });
  return {
    profile: { id: 'profile-manual-test', name: 'Manual Test User', email: 'manual-test@example.com', primaryCurrency: 'INR', locale: 'en-IN', timezone: 'Asia/Kolkata', createdAt: isoTime(firstThis), updatedAt: isoTime(firstThis), role: 'user', payFrequency: 'monthly', financialPreferences: { usePrimaryCurrency: true, monthStartsOn: 1 } },
    accounts: [
      { id: 'acc-check', name: 'Test Checking', type: 'checking', currencyCode: 'INR', initialBalance: 20000, currentBalance: 100500, institutionName: 'Test Bank', isArchived: false, createdAt: isoTime(firstThis), updatedAt: isoTime(firstThis) },
      { id: 'acc-save', name: 'Test Savings', type: 'savings', currencyCode: 'INR', initialBalance: 150000, currentBalance: 170000, institutionName: 'Test Bank', isArchived: false, createdAt: isoTime(firstThis), updatedAt: isoTime(firstThis) },
    ],
    categories: [
      { id: 'cat-salary', name: 'Test Salary', type: 'income', isDefault: true, createdAt: isoTime(firstThis) },
      { id: 'cat-groceries', name: 'Test Groceries', type: 'expense', isDefault: true, createdAt: isoTime(firstThis) },
      { id: 'cat-transport', name: 'Test Transport', type: 'expense', isDefault: true, createdAt: isoTime(firstThis) },
      { id: 'cat-rent', name: 'Test Rent', type: 'expense', isDefault: true, createdAt: isoTime(firstThis) },
    ],
    transactions: [
      t('tx-1', 'acc-check', 'income', 60000, 'cat-salary', dThis(1), 'Test Salary Corp'),
      t('tx-2', 'acc-check', 'expense', 12000, 'cat-groceries', dThis(5), 'TestGrocer'),
      t('tx-3', 'acc-check', 'expense', 3000, 'cat-transport', dThis(8), 'TestRide'),
      t('tx-4', 'acc-check', 'expense', 4500, 'cat-groceries', dThis(12), 'TestGrocer'),
      t('tx-5', 'acc-check', 'transfer', 20000, undefined, dThis(10), 'Transfer to savings', 'acc-save'),
      t('tx-6', 'acc-check', 'income', 60000, 'cat-salary', dPrev(1), 'Test Salary Corp'),
      t('tx-7', 'acc-check', 'expense', 21000, 'cat-groceries', dPrev(15), 'TestGrocer'),
    ],
    recurring: [
      { id: 'rec-1', accountId: 'acc-check', type: 'expense', amount: 15000, currencyCode: 'INR', categoryId: 'cat-rent', merchant: 'TestLandlord', description: 'Phase4B manual test rent', frequency: 'monthly', startDate: firstThis, nextOccurrenceAt: firstNext, isActive: true, createdAt: isoTime(firstThis), updatedAt: isoTime(firstThis) },
    ],
    budgets: [
      { id: 'bud-1', categoryId: 'cat-groceries', currencyCode: 'INR', limit: 20000, spent: 16500, period: 'monthly', startDate: firstThis, endDate: lastThis, createdAt: isoTime(firstThis) },
    ],
    goals: [
      { id: 'goal-1', title: 'Test Emergency Fund', targetAmount: 500000, currentAmount: 150000, currencyCode: 'INR', targetDate: iso(new Date(y + 1, m, 1)), status: 'active', createdAt: isoTime(firstThis) },
    ],
  };
}
const CORE_KEYS = ['finwise.profile.v2', 'finwise.accounts.v2', 'finwise.categories.v2', 'finwise.transactions.v2', 'finwise.recurring.v2', 'finwise.budgets.v2', 'finwise.goals.v2'];
function seedExpression(seed) {
  const sets = [
    ['finwise.profile.v2', seed.profile], ['finwise.accounts.v2', seed.accounts],
    ['finwise.categories.v2', seed.categories], ['finwise.transactions.v2', seed.transactions],
    ['finwise.recurring.v2', seed.recurring], ['finwise.budgets.v2', seed.budgets],
    ['finwise.goals.v2', seed.goals],
  ];
  return sets.map(([k, v]) => `localStorage.setItem('${k}', ${JSON.stringify(JSON.stringify(v))});`).join('\n')
    + '\nlocalStorage.removeItem("finwise.intelligence.snapshots.v1");\nlocalStorage.removeItem("finwise.intelligence.insights.v1");\n"seeded"';
}
/* ------------------------------------------------------------- page helpers */
async function evalJs(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result.value;
}
const innerText = (cdp) => evalJs(cdp, 'document.body.innerText');
const pagePath = (cdp) => evalJs(cdp, 'location.pathname');
const goto = async (cdp, route, settle = 1000) => { await cdp.send('Page.navigate', { url: APP + route }); await sleep(settle); };
const clickLink = (cdp, href) => evalJs(cdp, `(() => { const el = document.querySelector('a[href="${href}"]'); if (!el) return 'missing-link'; el.click(); return 'clicked'; })()`);
const digitsOf = (s) => (s === null || s === undefined) ? null : (String(s).replace(/\D/g, '') || null);
const moneyOf = (s) => {
  if (s === null || s === undefined) return null;
  const m = String(s).match(/(\d[\d,]*)(?:\.\d+)?/);
  return m ? m[1].replace(/,/g, '') : null;
};
function lineAfter(text, label) {
  const needle = String(label).toLowerCase();
  const lines = String(text).split('\n').map((l) => l.trim());
  const i = lines.findIndex((l) => l.toLowerCase() === needle || l.toLowerCase().startsWith(needle));
  if (i === -1) return null;
  // innerText inserts a blank line between block-level elements (e.g. a
  // StatCard's label <p> and its value <p>), so the value is NOT necessarily
  // lines[i + 1]: walk forward and return the first non-empty line.
  for (let j = i + 1; j < lines.length; j++) { if (lines[j] !== '') return lines[j]; }
  return null;
}
function valueAfter(text, label) {
  // StatCard labels are rendered uppercase via CSS, so innerText returns the
  // transformed label — the lookup must be case-insensitive.
  const needle = String(label).toLowerCase();
  const lines = String(text).split('\n').map((l) => l.trim());
  const i = lines.findIndex((l) => l.toLowerCase() === needle || l.toLowerCase().startsWith(needle));
  if (i === -1) return null;
  for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) { if (/[\d.,]/.test(lines[j])) return lines[j]; }
  return null;
}

/* --------------------------------------------------------------------- main */
async function main() {
  // ---- T1a: bring up the LOCAL-MODE dev server (Supabase env blanked) --------
  const dev = await ensureDevServer(path.join(__dirname, 'p4b-dev-out.txt'));
  record('T1 local-mode dev server on :' + PORT + ' (this is the app under test)', await portOpen(PORT), dev.owned ? 'started by harness' : 'already running');

  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p4b-edge-'));
  const cdpPort = await freePort(9334);
  const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + cdpPort, `--user-data-dir=${profileDir}`, '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
  const version = await poll(async () => { try { const r = await fetch(`http://127.0.0.1:${cdpPort}/json/version`); return r.ok ? await r.json() : null; } catch { return null; } }, 30000, 'Edge CDP');
  record('T1 headless Edge launched with CDP', !!version, version && version.Browser);

  const created = await (await fetch(`http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(APP + '/overview')}`, { method: 'PUT' })).json();
  const cdp = await Cdp.connect(created.webSocketDebuggerUrl);
  cdp.on((msg) => {
    if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) {
      const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
      if (!/React DevTools/i.test(text)) consoleErrors.push(`[console.${msg.params.type}] ${text}`);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      pageErrors.push(msg.params.exceptionDetails.text + ' ' + ((msg.params.exceptionDetails.exception || {}).description || ''));
    } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      failedRequests.push(msg.params.entry.text);
    } else if (msg.method === 'Network.requestWillBeSent') {
      const url = (msg.params.request && msg.params.request.url) || '';
      if (url) allRequests.push(url);
    } else if (msg.method === 'Network.loadingFailed' && !/favicon/i.test(msg.params.errorText || '')) {
      failedRequests.push('net: ' + msg.params.errorText);
    }
  });
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Log.enable'); await cdp.send('Network.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(1800);
  // ---- T1: application load + local mode active ----------------------------
  const p = await pagePath(cdp);
  record('T1 app loads; local fallback mode active (no redirect to /login; Supabase env blanked)', p === '/overview', 'pathname=' + p);
  if (p !== '/overview') throw new Error('Server is NOT in local mode - aborting (dev server must start with VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY blanked).');

  // ---- seed browser-local test data (browser only, never the DB) ------------
  await evalJs(cdp, seedExpression(buildSeed()));
  await goto(cdp, '/overview');
  // Phase 3 always re-derives current_balance from initial_balance + every
  // transaction effect (never trusts the stored value), so the deterministic
  // expected figures are:
  //   Test Checking = 20,000 + 60,000 + 60,000 - 12,000 - 3,000 - 4,500 - 20,000 - 21,000 = 79,500
  //   Test Savings  = 150,000 + 20,000 (transfer in)                                        = 170,000
  //   Total balance / net worth                                                             = 249,500
  const overviewText = await innerText(cdp); dumps.overview = overviewText;
  record('T6 overview renders seeded data (Total balance 2,49,500 = balances re-derived from initial balance + transactions)',
    moneyOf(valueAfter(overviewText, 'Total balance')) === '249500', 'value=' + valueAfter(overviewText, 'Total balance'));
  const storageBefore = await evalJs(cdp, 'JSON.stringify(Object.fromEntries(Object.entries(localStorage).filter(([k]) => k.startsWith("finwise."))))');

  // ---- T6: Phase 3 regression tour via Sidebar clicks (desktop) -------------
  for (const route of ['accounts', 'transactions', 'budget', 'goals', 'analytics']) {
    await clickLink(cdp, '/' + route); await sleep(700);
    const rp = await pagePath(cdp);
    const text = await innerText(cdp);
    dumps['page-' + route] = text.slice(0, 1500);
    const contentOk = route === 'accounts' ? /Test Checking/.test(text)
      : route === 'transactions' ? /TestGrocer|Test Salary Corp/.test(text)
      : route === 'budget' ? /16,500|16500/.test(text)
      : route === 'goals' ? /Test Emergency Fund/.test(text)
      : /Income|Spending|Savings/i.test(text);
    record(`T6 /${route} renders via Sidebar with correct data`, rp === '/' + route && contentOk, 'pathname=' + rp);
  }
  // ---- T2: Digital Twin navigation via Sidebar ------------------------------
  await clickLink(cdp, '/digital-twin'); await sleep(1100);
  record('T2 /digital-twin reachable via Sidebar navigation', (await pagePath(cdp)) === '/digital-twin');

  // ---- T3/T4: twin content, derivation, evidence -----------------------------
  const twinText = await innerText(cdp); dumps.twinDesktop = twinText;
  const tl = twinText.split('\n').map((l) => l.trim().toLowerCase());
  record('T3 twin: State / Behaviour / Health / Relationships sections render', ['state', 'behaviour', 'health', 'relationships'].every((s) => tl.includes(s)));
  record('T3 twin: stat cards render', ['net worth', 'safe to spend', 'financial health', 'cash buffer'].every((s) => tl.includes(s)));
  record('T3 twin net worth = 2,49,500 (re-derived from accounts + transactions, not hardcoded)',
    moneyOf(valueAfter(twinText, 'Net worth')) === '249500', 'value=' + valueAfter(twinText, 'Net worth'));
  record('T3 behaviour derives groceries total 16,500 from transactions (12,000+4,500)', /16,500/.test(twinText));
  record('T3 relationships link real rows (account/category/budget/goal/recurring)', twinText.includes('Test Checking') && twinText.includes('Test Groceries') && twinText.includes('Test Emergency Fund') && twinText.includes('TestLandlord'));
  const evidenceCount = (twinText.match(/Evidence:/g) || []).length;
  record('T4 every available section carries an Evidence line with rule version', evidenceCount >= 4 && twinText.includes('v4b.1'), 'evidence lines=' + evidenceCount);
  record('T4 evidence cites real source counts (accounts/transactions...)', /accounts \d|transactions \d/.test(twinText));
  record('T3 twin memory: first snapshot auto-captured (guarded write)', /1 snapshot captured/.test(twinText));
  const snapCount = await evalJs(cdp, `JSON.parse(localStorage.getItem('finwise.intelligence.snapshots.v1') || '[]').length`);
  record('T3 snapshot storage row count = 1', snapCount === 1, 'count=' + snapCount);
  const storageAfterTour = await evalJs(cdp, 'JSON.stringify(Object.fromEntries(Object.entries(localStorage).filter(([k]) => k.startsWith("finwise."))))');
  {
    const beforeObj = JSON.parse(storageBefore); const afterObj = JSON.parse(storageAfterTour);
    const newKeys = Object.keys(afterObj).filter((k) => !(k in beforeObj));
    const changedCore = CORE_KEYS.filter((k) => beforeObj[k] !== afterObj[k]);
    record('T5 tour: twin wrote only its snapshot key; rendering never rewrites financial data', newKeys.every((k) => k === 'finwise.intelligence.snapshots.v1') && changedCore.length === 0, `newKeys=[${newKeys}] changedCore=[${changedCore}]`);
  }
  // ---- T5: refresh persistence / no duplication ------------------------------
  const coreBefore = await evalJs(cdp, `JSON.stringify(${JSON.stringify(CORE_KEYS)}.map((k) => localStorage.getItem(k)))`);
  await cdp.send('Page.reload'); await sleep(1700);
  record('T5 refresh keeps /digital-twin working from persisted data', (await pagePath(cdp)) === '/digital-twin');
  const twinText2 = await innerText(cdp); dumps.twinAfterRefresh = twinText2.slice(0, 2500);
  record('T5 after refresh: still exactly 1 snapshot (same day, no material change => no duplicate capture)', /1 snapshot captured/.test(twinText2));
  const snapCount2 = await evalJs(cdp, `JSON.parse(localStorage.getItem('finwise.intelligence.snapshots.v1') || '[]').length`);
  record('T5 after refresh: snapshot row count unchanged (no duplicates)', snapCount2 === 1, 'count=' + snapCount2);
  const coreAfter = await evalJs(cdp, `JSON.stringify(${JSON.stringify(CORE_KEYS)}.map((k) => localStorage.getItem(k)))`);
  record('T5 after refresh: transactions/accounts/budgets/goals byte-identical (no duplicates)', coreBefore === coreAfter);
  {
    const norm = (s) => String(s).replace(/loading…/g, '').replace(/\s+/g, ' ').trim();
    const a = norm(twinText), b = norm(twinText2);
    let diffAt = -1;
    for (let i = 0; i < Math.min(a.length, b.length); i++) { if (a[i] !== b[i]) { diffAt = i; break; } }
    if (diffAt === -1 && a.length !== b.length) diffAt = Math.min(a.length, b.length);
    const around = (s) => s.slice(Math.max(0, diffAt - 70), diffAt + 70);
    record('T8 deterministic: reload re-derives an identical twin (rendered values contain no randomness/time drift)',
      a === b, a === b ? 'twin text identical across reload (' + a.length + ' chars)' : `diff@${diffAt}: "${around(a)}" vs "${around(b)}"`);
  }
  const shotDesktop = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(__dirname, 'p4b-twin-desktop.png'), Buffer.from(shotDesktop.data, 'base64'));
  {
    const ov = await evalJs(cdp, '({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth})');
    record('T7 desktop (1440px): no horizontal overflow', ov.sw <= ov.cw + 2, JSON.stringify(ov));
  }

  // ---- T4b: honest insufficient-data pass (fresh empty storage) --------------
  await evalJs(cdp, 'localStorage.clear(); "cleared"');
  await cdp.send('Page.reload'); await sleep(1700);
  const emptyText = await innerText(cdp); dumps.twinEmpty = emptyText;
  record('T4 empty data: insufficient-data reasons shown with named missing collections', emptyText.includes('needs:'), emptyText.split('\n').filter((l) => l.includes('needs:')).slice(0, 4).join(' | '));
  record('T4 empty data: net worth renders the em-dash placeholder (no fabricated 0 / currency value)',
    lineAfter(emptyText, 'Net worth') === '—' && digitsOf(valueAfter(emptyText, 'Net worth')) === null,
    'label-value=' + JSON.stringify(lineAfter(emptyText, 'Net worth')));
  record('T4 empty data: 0 snapshots (no capture without real data)', /0 snapshots captured/.test(emptyText));

  // ---- T2b/T7: mobile viewport via MobileNav ---------------------------------
  await evalJs(cdp, seedExpression(buildSeed()));
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await goto(cdp, '/overview');
  record('T7 mobile (390px): overview loads', (await pagePath(cdp)) === '/overview');
  await evalJs(cdp, `(() => { const b = document.querySelector('button[aria-label="Open navigation menu"]'); if (!b) return 'missing-menu-button'; b.click(); return 'ok'; })()`);
  await sleep(600);
  const mobClick = await evalJs(cdp, `(() => { const el = document.querySelector('#mobile-nav-menu a[href="/digital-twin"]') || document.querySelector('a[href="/digital-twin"]'); if (!el) return 'missing-link'; el.click(); return 'ok'; })()`);
  await sleep(900);
  record('T2 MobileNav reaches /digital-twin', (await pagePath(cdp)) === '/digital-twin', mobClick);
  const mobText = await innerText(cdp); dumps.twinMobile = mobText;
  const ml = mobText.split('\n').map((l) => l.trim());
  record('T7 mobile twin renders all sections', ['State', 'Behaviour', 'Health', 'Relationships'].every((s) => ml.includes(s)));
  {
    const ov = await evalJs(cdp, '({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth})');
    record('T7 mobile (390px): no horizontal overflow / unusable sections', ov.sw <= ov.cw + 2, JSON.stringify(ov));
  }
  const shotMobile = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(__dirname, 'p4b-twin-mobile.png'), Buffer.from(shotMobile.data, 'base64'));
  // ---- T8: security (static source scan + runtime network evidence) ----------
  {
    const files = phase4bSourceFiles();
    record('T8 Phase 4B source set scanned (no Phase 3/Copilot file touched)',
      files.length >= 10 && files.every((f) => /intelligence|DigitalTwin/i.test(f)),
      files.length + ' files: ' + files.map((f) => path.basename(f)).join(', '));

    const secrets = scanForPattern(files, /service[_-]?role['"]?\s*[:=]|import\.meta\.env\.[A-Z0-9_]*(SERVICE_ROLE|SERVICE_KEY|SECRET)|AIza[0-9A-Za-z_\-]{10,}|\bsk-[A-Za-z0-9]{16,}|eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\./i);
    record('T8 no service-role key / secret env var / API key / JWT literal in Phase 4B source',
      secrets.length === 0, secrets.join(' | ') || 'none (anon key only, via the shared Supabase client)');

    const uids = scanForPattern(files, /['"][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}['"]/i);
    record('T8 no hardcoded user id (UUID literal) in Phase 4B source',
      uids.length === 0, uids.join(' | ') || 'none (identity comes from the verified session only)');

    const privilege = scanForPattern(files, /\.from\(['"](profiles|accounts|transactions|categories|recurring_transactions|budgets|goals)['"]|auth\.admin|serviceRole|setSession|refreshSession/i);
    record('T8 no privileged/DB bypass: no core-table access, no admin client, no auth bypass in Phase 4B',
      privilege.length === 0, privilege.join(' | ') || 'none (snapshots/insights only, RLS + session-scoped)');

    const aiTokens = scanForPattern(files, /generativelanguage|generateContent|gemini|openai|anthropic|\.functions\.invoke|\bfetch\s*\(|new WebSocket/i);
    record('T8 twin path uses no AI/API/network call at all (no Gemini, no edge function, no fetch)',
      aiTokens.length === 0, aiTokens.join(' | ') || 'none');

    const impure = scanForPattern(pureDerivationFiles(), /from\s+['"][^'"]*(\/services\/|@supabase)/i);
    record('T8 pure derivation modules (src/intelligence) import no service/Supabase layer',
      impure.length === 0, impure.join(' | ') || pureDerivationFiles().map((f) => path.basename(f)).join(', '));

    // Same-origin means host-identical, so Vite's own HMR websocket
    // (ws://127.0.0.1:5199) counts as same-origin and is not a false positive.
    const offOrigin = allRequests.filter((u) => {
      try {
        const parsed = new URL(u);
        if (['data:', 'blob:', 'about:', 'devtools:'].includes(parsed.protocol)) return false;
        return parsed.host !== APP_HOST;
      } catch { return false; }
    });
    record('T8 runtime: zero off-origin requests in the whole session (no Supabase/Gemini traffic from the twin)',
      offOrigin.length === 0, offOrigin.slice(0, 5).join(' | ') || allRequests.length + ' requests, all same-origin (' + APP_HOST + ', incl. Vite HMR)');
  }

  // ---- console/runtime error summary -----------------------------------------
  record('no console errors/warnings during the whole session', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | ') || 'none');
  record('no uncaught page exceptions during the whole session', pageErrors.length === 0, pageErrors.slice(0, 5).join(' | ') || 'none');
  record('no failed network requests during the whole session', failedRequests.length === 0, failedRequests.slice(0, 5).join(' | ') || 'none');

  try { await cdp.send('Browser.close'); } catch { /* already closing */ }
  try { edge.kill(); } catch { /* already dead */ }
  await sleep(500);
  killOwnBrowsers(profileDir);
  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* locked is fine */ }
  if (dev.owned && dev.child) { try { dev.child.kill(); } catch { /* already dead */ } }

  const passCount = results.filter((r) => r.pass).length;
  const ok = passCount === results.length;
  fs.writeFileSync(path.join(__dirname, 'p4b-manual-results.json'),
    JSON.stringify({ ok, passCount, total: results.length, results, consoleErrors, pageErrors, failedRequests }, null, 2));
  let report = `PHASE 4B MANUAL FUNCTIONAL TEST — ${ok ? 'ALL PASS' : 'FAILURES PRESENT'} (${passCount}/${results.length})\n`;
  report += `Environment: local-mode dev server :5199, headless Edge (CDP), seeded browser-local test data\n\n`;
  for (const r of results) report += `${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '\n      ' + r.detail.slice(0, 400) : ''}\n`;
  report += `\n--- console errors ---\n${consoleErrors.length ? consoleErrors.join('\n') : '(none)'}\n`;
  report += `\n--- page exceptions ---\n${pageErrors.length ? pageErrors.join('\n') : '(none)'}\n`;
  report += `\n--- failed requests ---\n${failedRequests.length ? failedRequests.join('\n') : '(none)'}\n`;
  report += `\n--- DIGITAL TWIN (desktop) innerText ---\n${dumps.twinDesktop || '(captured)'}\n`;
  report += `\n--- DIGITAL TWIN (empty data) innerText ---\n${dumps.twinEmpty || '(captured)'}\n`;
  report += `\n--- OVERVIEW innerText ---\n${(dumps.overview || '').slice(0, 3000)}\n`;
  fs.writeFileSync(path.join(__dirname, 'p4b-manual-report.txt'), report);
  console.log(`DONE ${passCount}/${results.length} -> p4b-manual-report.txt`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  record('harness completed without fatal error', false, e && e.message);
  const passCount = results.filter((r) => r.pass).length;
  fs.writeFileSync(path.join(__dirname, 'p4b-manual-results.json'),
    JSON.stringify({ ok: false, passCount, total: results.length, results, consoleErrors, pageErrors, failedRequests, fatal: e && e.message }, null, 2));
  console.log('FATAL: ' + (e && e.message));
  process.exit(1);
});






