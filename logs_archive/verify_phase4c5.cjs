/* Phase 4C-5 verification — Analytics + Hidden Spending UI integration.
 *
 * Runs against a LOCAL-MODE Vite dev server (Supabase env blanked) and seeds
 * clearly-labelled test data into the BROWSER's localStorage ONLY. It never
 * touches the network, the Supabase project, or app source, and it adds no new
 * dependencies (headless Edge + raw CDP over the global WebSocket, the same
 * approach as p4b-manual-test.cjs).
 *
 * Scenario S1 (populated): all analytics + detector sections render real data,
 * the over-budget band renders, evidence lines render, no horizontal overflow
 * at 1440px and 390px, no console/page errors, all requests same-origin.
 * Scenario S2 (thin data): honest insufficient states render, and
 * available-with-empty sections show "No pattern detected" instead.
 *
 * Writes: p4c5-report.txt, p4c5-results.json, p4c5-desktop.png, p4c5-mobile.png
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');

const PORT = 5215;
const APP = 'http://127.0.0.1:' + PORT;
const APP_HOST = '127.0.0.1:' + PORT;
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p));

const results = [];
const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
const allRequests = [];
const requestUrls = new Map();
const dumps = {};
/* Tracked so the top-level error path can tear down exactly what this harness
 * started (never the user's own browser or dev server). */
let ownedProfileDir = null;
let ownedDevChild = null;

function record(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail === undefined ? '' : String(detail) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + String(detail).slice(0, 220) : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- CDP client */
class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = []; }
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const client = new Cdp(ws);
      ws.onmessage = (ev) => {
        try { client.handle(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch { /* ignore */ }
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
async function poll(fn, timeoutMs, label) {
  const start = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* retry */ }
    if (Date.now() - start > timeoutMs) throw new Error('timeout waiting for ' + label);
    await sleep(400);
  }
}
async function freePort(from) {
  for (let p = from; p < from + 40; p++) { if (!(await portOpen(p))) return p; }
  throw new Error('no free CDP port found');
}
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
function killOwnBrowsers(profileDir) {
  if (!profileDir) return;
  try {
    const ps = 'Get-CimInstance Win32_Process -Filter "Name=\'msedge.exe\'" | '
      + 'Where-Object { $_.CommandLine -like \'*' + profileDir.replace(/'/g, "''") + '*\' } | '
      + 'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }';
    spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'ignore', windowsHide: true, timeout: 20000 });
  } catch { /* best effort */ }
}

/* ------------------------------------------------------------- page helpers */
async function evalJs(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result.value;
}
const pagePath = (cdp) => evalJs(cdp, 'location.pathname');
const innerText = (cdp) => evalJs(cdp, 'document.body.innerText');
const goto = async (cdp, route, settle = 1500) => { await cdp.send('Page.navigate', { url: APP + route }); await sleep(settle); };
/* Every Card is a `div.rounded-2xl` wrapping an <h2>; map heading -> card text so
 * assertions are per-section and cannot be satisfied by another section. */
const SECTION_MAP_EXPR = `JSON.stringify([...document.querySelectorAll('h2')].map((h) => ({ title: h.innerText.trim(), text: (h.closest('div.rounded-2xl') || document.body).innerText })))`;
const sectionMap = async (cdp) => JSON.parse(await evalJs(cdp, SECTION_MAP_EXPR));
const cardText = (map, title) => {
  const entry = map.find((c) => c.title === title);
  return entry ? entry.text : null;
};
const overflow = async (cdp) => JSON.parse(await evalJs(cdp, 'JSON.stringify({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth })'));
/* Lists the outermost elements whose box extends past the layout viewport, so a
 * mobile overflow can be attributed to a specific component instead of guessed. */
const OFFENDERS_EXPR = `(() => {
  const vw = document.documentElement.clientWidth;
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > vw + 1) {
      out.push({ tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 80), right: Math.round(r.right), width: Math.round(r.width), scrollW: el.scrollWidth, clientW: el.clientWidth, text: String(el.innerText || '').trim().slice(0, 32) });
    }
  }
  out.sort((a, b) => b.right - a.right);
  return JSON.stringify({ vw, count: out.length, top: out.slice(0, 8) });
})()`;
async function screenshot(cdp, file) {
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(__dirname, file), Buffer.from(shot.data, 'base64'));
}

/* ------------------------------------------------------------------- seed db */
const iso = (d) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const isoTime = (date) => new Date(date + 'T10:00:00').toISOString();

/** S1 — populated dataset (mirrors the p4b test seed, extended for 4C-5). */
function buildFullSeed() {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const d = (monthOffset, day) => iso(new Date(y, m + monthOffset, day));
  const t = (id, accountId, type, amount, categoryId, date, merchant) => ({
    id, accountId, type, amount, currencyCode: 'INR', categoryId, merchant,
    description: 'Phase4C-5 manual test data', date, isRecurring: false,
    createdAt: isoTime(date), updatedAt: isoTime(date),
  });
  const snap = (id, daysAgo, netWorth, health, safeToSpend) => ({
    id, userId: 'local', capturedAt: new Date(Date.now() - daysAgo * 86400000).toISOString(),
    netWorth, cashFlow: 2500, safeToSpend, financialHealthScore: health,
    income: 60000, expenses: 38000, savingsRate: 36.7, debt: 0, currencyCode: 'INR',
  });
  return {
    profile: { id: 'profile-4c5', name: 'Phase4C5 Test User', email: 'phase4c5@example.com', primaryCurrency: 'INR', locale: 'en-IN', timezone: 'Asia/Kolkata', createdAt: isoTime(d(0, 1)), updatedAt: isoTime(d(0, 1)), role: 'user', payFrequency: 'monthly', financialPreferences: { usePrimaryCurrency: true, monthStartsOn: 1 } },
    accounts: [
      { id: 'acc-check', name: 'Test Checking', type: 'checking', currencyCode: 'INR', initialBalance: 20000, currentBalance: 100500, institutionName: 'Test Bank', isArchived: false, createdAt: isoTime(d(0, 1)), updatedAt: isoTime(d(0, 1)) },
      { id: 'acc-cash', name: 'TestCash Wallet', type: 'cash', currencyCode: 'INR', initialBalance: 5000, currentBalance: 5000, isArchived: false, createdAt: isoTime(d(0, 1)), updatedAt: isoTime(d(0, 1)) },
      { id: 'acc-cash2', name: 'TestCash Used Wallet', type: 'cash', currencyCode: 'INR', initialBalance: 2000, currentBalance: 1900, isArchived: false, createdAt: isoTime(d(0, 1)), updatedAt: isoTime(d(0, 1)) },
    ],
    categories: [
      { id: 'cat-salary', name: 'Test Salary', type: 'income', isDefault: true, createdAt: isoTime(d(0, 1)) },
      { id: 'cat-groceries', name: 'Test Groceries', type: 'expense', isDefault: true, createdAt: isoTime(d(0, 1)) },
      { id: 'cat-transport', name: 'Test Transport', type: 'expense', isDefault: true, createdAt: isoTime(d(0, 1)) },
    ],
    transactions: [
      t('tx-income', 'acc-check', 'income', 60000, 'cat-salary', d(0, 1), 'Test Salary Corp'),
      t('tx-groc1', 'acc-check', 'expense', 12000, 'cat-groceries', d(0, 5), 'TestGrocer'),
      t('tx-groc2', 'acc-check', 'expense', 4500, 'cat-groceries', d(0, 12), 'TestGrocer'),
      t('tx-transport', 'acc-check', 'expense', 3000, 'cat-transport', d(0, 8), 'TestRide'),
      t('tx-uncat', 'acc-check', 'expense', 800, undefined, d(0, 20), 'TestUnlabeled'),
      t('tx-coffee1', 'acc-check', 'expense', 60, 'cat-transport', d(0, 6), 'TestCoffee'),
      t('tx-coffee2', 'acc-check', 'expense', 60, 'cat-transport', d(0, 9), 'TestCoffee'),
      t('tx-coffee3', 'acc-check', 'expense', 60, 'cat-transport', d(0, 14), 'TestCoffee'),
      t('tx-stream1', 'acc-check', 'expense', 499, 'cat-transport', d(0, 3), 'TestStream'),
      t('tx-fee1', 'acc-check', 'expense', 250, 'cat-transport', d(0, 18), 'TestBank Fee'),
      t('tx-cash-shop', 'acc-cash2', 'expense', 100, 'cat-transport', d(0, 7), 'TestCashShop'),
      t('tx-prev-income', 'acc-check', 'income', 60000, 'cat-salary', d(-1, 1), 'Test Salary Corp'),
      t('tx-prev-groc', 'acc-check', 'expense', 21000, 'cat-groceries', d(-1, 15), 'TestGrocer'),
      t('tx-prev-stream', 'acc-check', 'expense', 499, 'cat-transport', d(-1, 3), 'TestStream'),
      t('tx-old-stream', 'acc-check', 'expense', 499, 'cat-transport', d(-2, 3), 'TestStream'),
      t('tx-prev-fee', 'acc-check', 'expense', 120, 'cat-transport', d(-1, 18), 'TestInterest Charge'),
    ],
    recurring: [
      { id: 'rec-1', accountId: 'acc-check', type: 'expense', amount: 15000, currencyCode: 'INR', categoryId: 'cat-groceries', merchant: 'TestLandlord', description: 'Phase4C-5 manual test rent', frequency: 'monthly', startDate: d(0, 1), nextOccurrenceAt: d(1, 1), isActive: true, createdAt: isoTime(d(0, 1)), updatedAt: isoTime(d(0, 1)) },
      { id: 'rec-2', accountId: 'acc-check', type: 'expense', amount: 1300, currencyCode: 'INR', categoryId: 'cat-transport', merchant: 'TestWeekly Gym', description: 'Phase4C-5 manual test weekly', frequency: 'weekly', startDate: d(0, 1), nextOccurrenceAt: d(1, 1), isActive: true, createdAt: isoTime(d(0, 1)), updatedAt: isoTime(d(0, 1)) },
    ],
    budgets: [
      { id: 'bud-under', categoryId: 'cat-groceries', currencyCode: 'INR', limit: 20000, period: 'monthly', startDate: d(0, 1), endDate: iso(new Date(y, m + 1, 0)), createdAt: isoTime(d(0, 1)) },
      { id: 'bud-over', categoryId: 'cat-transport', currencyCode: 'INR', limit: 3000, period: 'monthly', startDate: d(0, 1), endDate: iso(new Date(y, m + 1, 0)), createdAt: isoTime(d(0, 1)) },
    ],
    goals: [
      { id: 'goal-1', title: 'Test Emergency Fund', targetAmount: 500000, currentAmount: 150000, currencyCode: 'INR', targetDate: iso(new Date(y + 1, m, 1)), status: 'active', createdAt: isoTime(d(0, 1)) },
    ],
    snapshots: [snap('snap-3', 60, 240000, 68, 8200), snap('snap-2', 30, 245000, 71, 8600), snap('snap-1', 1, 249500, 74, 9100)],
  };
}



/** S2 — metric-free dataset: honest insufficient / empty states. */
function buildThinSeed() {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const d = (monthOffset, day) => iso(new Date(y, m + monthOffset, day));
  const t = (id, accountId, type, amount, categoryId, date, merchant) => ({
    id, accountId, type, amount, currencyCode: 'INR', categoryId, merchant,
    description: 'Phase4C-5 thin test data', date, isRecurring: false,
    createdAt: isoTime(date), updatedAt: isoTime(date),
  });
  return {
    profile: { id: 'profile-thin', name: 'Phase4C5 Thin User', email: 'thin@example.com', primaryCurrency: 'INR', locale: 'en-IN', timezone: 'Asia/Kolkata', createdAt: isoTime(d(0, 1)), updatedAt: isoTime(d(0, 1)), role: 'user', payFrequency: 'monthly', financialPreferences: { usePrimaryCurrency: true, monthStartsOn: 1 } },
    accounts: [
      { id: 'acc-check', name: 'Thin Checking', type: 'checking', currencyCode: 'INR', initialBalance: 1000, currentBalance: 4000, institutionName: 'Test Bank', isArchived: false, createdAt: isoTime(d(0, 1)), updatedAt: isoTime(d(0, 1)) },
    ],
    categories: [
      { id: 'cat-salary', name: 'Thin Salary', type: 'income', isDefault: true, createdAt: isoTime(d(0, 1)) },
      { id: 'cat-food', name: 'Thin Food', type: 'expense', isDefault: true, createdAt: isoTime(d(0, 1)) },
    ],
    transactions: [
      t('thin-income', 'acc-check', 'income', 5000, 'cat-salary', d(0, 1), 'Thin Salary Corp'),
      t('thin-food', 'acc-check', 'expense', 400, 'cat-food', d(0, 4), 'Thin Cafe'),
    ],
    recurring: [],
    budgets: [],
    goals: [],
    snapshots: [],
  };
}

const SEED_KEYS = ['profile', 'accounts', 'categories', 'transactions', 'recurring', 'budgets', 'goals'];
const SEED_STORAGE = { profile: 'finwise.profile.v2', accounts: 'finwise.accounts.v2', categories: 'finwise.categories.v2', transactions: 'finwise.transactions.v2', recurring: 'finwise.recurring.v2', budgets: 'finwise.budgets.v2', goals: 'finwise.goals.v2' };
function seedExpression(seed) {
  const sets = SEED_KEYS.map((k) => `localStorage.setItem('${SEED_STORAGE[k]}', ${JSON.stringify(JSON.stringify(seed[k]))});`);
  sets.push(`localStorage.setItem('finwise.intelligence.snapshots.v1', ${JSON.stringify(JSON.stringify(seed.snapshots))});`);
  sets.push('localStorage.removeItem("finwise.intelligence.insights.v1");');
  sets.push('"seeded"');
  return sets.join('\n');
}
/* Storage keys that must be byte-identical before/after viewing Analytics: the
 * Analytics page is read-only and must never mutate the financial core. */
const CORE_KEYS = SEED_KEYS.map((k) => SEED_STORAGE[k]);
const coreSnapshotExpr = `JSON.stringify(${JSON.stringify(CORE_KEYS)}.map((k) => localStorage.getItem(k)))`;


/* ------------------------------------------------------------------- checks */
const ANALYTICS_CARDS = [
  'Net worth trend',
  'Health score trend',
  'Safe-to-spend trend',
  'Spending by category',
  'Budget utilization',
  'Recurring spending',
  'Income vs expense over time',
];
const DETECTOR_CARDS = [
  'Small recurring charges',
  'Subscription-like patterns',
  'Uncategorized spending',
  'Category concentration',
  'Fee and charge patterns',
  'Cash tracking gaps',
];

function checkCard(map, title, needles, mustNotContain = []) {
  const text = cardText(map, title);
  if (text === null) return record(`card "${title}" renders`, false, 'card heading not found');
  /* innerText reflects CSS text-transform, so table headers arrive uppercased
   * ("EXPENSES"); compare case-insensitively. */
  const hay = text.toLowerCase();
  const missing = needles.filter((n) => !hay.includes(n.toLowerCase()));
  const forbidden = mustNotContain.filter((n) => hay.includes(n.toLowerCase()));
  dumps[title] = text;
  return record(
    `card "${title}" shows ${needles.length} expected value(s)`,
    missing.length === 0 && forbidden.length === 0,
    missing.length === 0 && forbidden.length === 0
      ? needles.join(' | ')
      : `missing=[${missing.join(', ')}] forbidden=[${forbidden.join(', ')}]`,
  );
}

/* --------------------------------------------------------------------- main */
async function main() {
  const dev = await ensureDevServer(path.join(__dirname, 'p4c5-dev-out.txt'));
  ownedDevChild = dev.owned ? dev.child : null;
  record('T1 local-mode dev server on :' + PORT, await portOpen(PORT), dev.owned ? 'started by harness' : 'already running');

  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p4c5-edge-'));
  ownedProfileDir = profileDir;
  const cdpPort = await freePort(9344);
  spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
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
      if (url) { allRequests.push(url); requestUrls.set(msg.params.requestId, url); }
    } else if (msg.method === 'Network.loadingFailed' && !/favicon/i.test(msg.params.errorText || '')) {
      const req = requestUrls.get(msg.params.requestId) || '(url unknown)';
      failedRequests.push('net: ' + msg.params.errorText + ' -> ' + req + ' [canceled=' + !!msg.params.canceled + ']');
    }
  });
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Log.enable'); await cdp.send('Network.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  /* The tab must have committed the app's origin before localStorage is usable
   * (about:blank denies storage access, i.e. SecurityError). */
  await goto(cdp, '/overview', 2200);
  const origin = await evalJs(cdp, 'location.origin');
  const loadedPath = await pagePath(cdp);
  record('T1 app loads in local fallback mode (Supabase env blanked, no redirect to /login)',
    origin === APP && loadedPath === '/overview', 'origin=' + origin + ' pathname=' + loadedPath);
  if (origin !== APP) throw new Error('Server is NOT in local mode — aborting (VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY must be blanked).');

  /* ============================ S1: populated dataset ====================== */
  await evalJs(cdp, seedExpression(buildFullSeed()));
  const coreBefore = await evalJs(cdp, coreSnapshotExpr);
  await goto(cdp, '/analytics', 2500);
  const pathS1 = await pagePath(cdp);
  record('S1 /analytics route reachable (no redirect, no routing change)', pathS1 === '/analytics', 'pathname=' + pathS1);

  const mapS1 = await sectionMap(cdp);
  const titlesS1 = mapS1.map((c) => c.title);
  const missingTitles = [...ANALYTICS_CARDS, ...DETECTOR_CARDS].filter((t) => !titlesS1.includes(t));
  record('S1 all 7 analytics + 6 hidden-spending sections render', missingTitles.length === 0,
    missingTitles.length === 0 ? titlesS1.length + ' card heading(s) found' : 'missing: ' + missingTitles.join(', '));

  checkCard(mapS1, 'Net worth trend', ['2,49,500.00', '2,45,000.00', '2,40,000.00']);
  checkCard(mapS1, 'Health score trend', ['74/100', '71/100', '68/100']);
  checkCard(mapS1, 'Safe-to-spend trend', ['9,100.00', '8,600.00', '8,200.00']);
  checkCard(mapS1, 'Spending by category', ['Test Groceries', 'Uncategorized', '%']);
  checkCard(mapS1, 'Budget utilization', ['Test Groceries', 'Test Transport', 'over budget', '134.3%', '82.5%']);
  checkCard(mapS1, 'Recurring spending', ['Total monthly commitment', '20,633.33', '15,000.00', '5,633.33']);
  checkCard(mapS1, 'Income vs expense over time', ['Income', 'Expenses', 'Net flow', '60,000.00', '21,329.00', '38,671.00']);
  checkCard(mapS1, 'Small recurring charges', ['TestCoffee', '180.00', '3×']);
  checkCard(mapS1, 'Subscription-like patterns', ['TestStream', 'subscription-like pattern detected']);
  checkCard(mapS1, 'Uncategorized spending', ['800.00']);
  checkCard(mapS1, 'Category concentration', ['represents', '% of recorded expenses', 'Test Groceries']);
  checkCard(mapS1, 'Fee and charge patterns', ['TestBank Fee', 'TestInterest Charge', '250.00']);
  checkCard(mapS1, 'Cash tracking gaps', ['TestCash Wallet'], ['TestCash Used Wallet']);

  const evidenceCards = ANALYTICS_CARDS.concat(DETECTOR_CARDS).filter((t) => (cardText(mapS1, t) || '').includes('Evidence:'));
  record('S1 every rendered section carries an Evidence line', evidenceCards.length === 13, evidenceCards.length + '/13 cards show evidence');

  const bodyS1 = await innerText(cdp);
  const forbiddenS1 = ['NaN', 'Infinity', 'undefined', 'Insufficient data'];
  const foundS1 = forbiddenS1.filter((t) => bodyS1.includes(t));
  record('S1 populated page shows no insufficient placeholder and no NaN/undefined', foundS1.length === 0,
    foundS1.length === 0 ? 'clean' : 'found: ' + foundS1.join(', '));

  const overS1 = await overflow(cdp);
  record('S1 desktop (1440px) no horizontal page overflow', overS1.scrollWidth <= overS1.innerWidth + 1, JSON.stringify(overS1));
  await screenshot(cdp, 'p4c5-desktop.png');

  /* ---------------- S1 mobile-width layout (390x844, DPR 2) ---------------- */
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, screenWidth: 390, screenHeight: 844, deviceScaleFactor: 2, mobile: true, viewport: { x: 0, y: 0, width: 390, height: 844, scale: 1 } });
  await sleep(1200);
  const overM = JSON.parse(await evalJs(cdp, 'JSON.stringify({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, innerWidth: window.innerWidth })'));
  record('S1 mobile (390px) layout is genuinely 390 CSS px wide', overM.cw >= 360 && overM.cw <= 400, JSON.stringify(overM));
  record('S1 mobile (390px) no horizontal page overflow', overM.sw <= overM.cw + 1, JSON.stringify(overM));
  const offM = JSON.parse(await evalJs(cdp, OFFENDERS_EXPR));
  dumps['S1 mobile overflow offenders'] = JSON.stringify(offM.top, null, 1);
  record('S1 mobile (390px) no element extends past the layout viewport', offM.count === 0,
    offM.count === 0 ? 'none' : offM.count + ' element(s): ' + JSON.stringify(offM.top.slice(0, 4)));
  const mapMobile = await sectionMap(cdp);
  const mobileTitles = [...ANALYTICS_CARDS, ...DETECTOR_CARDS].filter((t) => !mapMobile.some((c) => c.title === t));
  record('S1 mobile: all sections still render', mobileTitles.length === 0, mobileTitles.length === 0 ? 'all present' : 'missing: ' + mobileTitles.join(', '));
  await screenshot(cdp, 'p4c5-mobile.png');

  /* Baseline: does the untouched app shell itself overflow at 390px? This
   * separates a pre-existing shell behaviour from anything the Analytics page
   * renders. */
  await goto(cdp, '/overview');
  const overBase = JSON.parse(await evalJs(cdp, 'JSON.stringify({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })'));
  record('baseline mobile: app shell overflow at 390px measured on /overview (context only)', true, JSON.stringify(overBase));
  await goto(cdp, '/analytics');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(800);

  /* ---------------- read-only proof: financial core untouched -------------- */
  const coreAfter = await evalJs(cdp, coreSnapshotExpr);
  record('S1 viewing Analytics does not mutate financial core storage (read-only page)', coreBefore === coreAfter,
    coreBefore === coreAfter ? 'finwise.*.v2 keys byte-identical' : 'core storage changed while only viewing Analytics');

  /* ======================= S2: thin dataset (no metrics) =================== */
  await evalJs(cdp, seedExpression(buildThinSeed()));
  await goto(cdp, '/analytics', 2500);
  const mapS2 = await sectionMap(cdp);
  const bodyS2 = await innerText(cdp);
  record('S2 thin-data /analytics still loads', (await pagePath(cdp)) === '/analytics', 'pathname=' + await pagePath(cdp));

  const insuffTitles = ['Net worth trend', 'Health score trend', 'Safe-to-spend trend', 'Budget utilization',
    'Recurring spending', 'Subscription-like patterns', 'Category concentration', 'Cash tracking gaps'];
  const insuffOk = insuffTitles.filter((t) => (cardText(mapS2, t) || '').includes('Insufficient data'));
  record('S2 all 8 un-derivable sections show "Insufficient data" (no fake zeroes)',
    insuffOk.length === insuffTitles.length, insuffOk.length + '/' + insuffTitles.length + ' sections');

  const reasonChecks = [
    ['Net worth trend', 'snapshot'],
    ['Budget utilization', 'No budgets are set up yet'],
    ['Recurring spending', 'No active recurring transactions are tracked yet'],
    ['Cash tracking gaps', 'needs a cash-type account'],
  ];
  const reasonMisses = reasonChecks.filter(([t, needle]) => !(cardText(mapS2, t) || '').toLowerCase().includes(needle.toLowerCase()));
  record('S2 insufficient sections show the engine\'s actual reason/detail', reasonMisses.length === 0,
    reasonMisses.length === 0 ? reasonChecks.map(([t]) => t).join(', ') : 'missing reason in: ' + reasonMisses.map(([t]) => t).join(', '));

  const emptyCards = ['Small recurring charges', 'Uncategorized spending', 'Fee and charge patterns']
    .filter((t) => (cardText(mapS2, t) || '').includes('No pattern detected'));
  record('S2 available-with-empty sections show "No pattern detected" (never mistaken for insufficient data)',
    emptyCards.length === 3, emptyCards.join(', ') + ' (3/3 expected)');

  const emptyCardsHaveEvidence = ['Small recurring charges', 'Uncategorized spending', 'Fee and charge patterns']
    .every((t) => (cardText(mapS2, t) || '').includes('Evidence:'));
  record('S2 empty-result sections still carry evidence (available state)', emptyCardsHaveEvidence, 'rule + source line present');

  record('S2 thin-data page renders the derivable sections without placeholder money', !bodyS2.includes('₹0.00') && !bodyS2.includes('NaN') && !bodyS2.includes('undefined'),
    'checked for ₹0.00 / NaN / undefined');
  const overS2 = JSON.parse(await evalJs(cdp, 'JSON.stringify({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })'));
  record('S2 no horizontal overflow', overS2.sw <= overS2.cw + 1, JSON.stringify(overS2));
  dumps['S2 body'] = bodyS2;

  /* ==================== network / runtime integrity checks ================= */
  const offOrigin = allRequests.filter((u) => !u.startsWith(APP) && !u.startsWith('ws://' + APP_HOST) && !u.startsWith('data:') && !u.startsWith('blob:'));
  record('T9 no off-origin (Supabase/CDN/AI) requests were made', offOrigin.length === 0,
    offOrigin.length === 0 ? allRequests.length + ' requests, all same-origin incl. Vite HMR' : offOrigin.slice(0, 5).join(' | '));
  /* The Supabase *client module* is legitimately loaded from the dev server even
   * in local mode; what must never happen is a network call to a Supabase host. */
  const supabaseHits = allRequests.filter((u) => /supabase\.(co|in|net)|\.supabase\.com/i.test(u));
  record('T9 no Supabase host was contacted (local mode: no remote call)', supabaseHits.length === 0, supabaseHits.slice(0, 3).join(' | ') || 'none');
  const aiHits = allRequests.filter((u) => /openai|anthropic|gemini|api\/ai|chat\/completions/i.test(u));
  record('T9 no AI endpoint was contacted', aiHits.length === 0, aiHits.slice(0, 3).join(' | ') || 'none');
  record('T9 no uncaught page exception during both scenarios', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || 'none');
  record('T9 no console error/warning during both scenarios', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || 'none');
  record('T9 no failed resource load / network error', failedRequests.length === 0, failedRequests.slice(0, 3).join(' | ') || 'none');

  await cdp.send('Page.close').catch(() => {});
  cleanup(profileDir, dev.child);
}

/* ------------------------------------------------------------ report + teardown */
function cleanup(profileDir, devChild) {
  killOwnBrowsers(profileDir);
  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* best effort */ }
  if (devChild && devChild.exitCode === null) { try { spawnSync('taskkill', ['/PID', String(devChild.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* best effort */ } }
}

function writeReport() {
  const passed = results.filter((r) => r.pass).length;
  let report = 'PHASE 4C-5 — ANALYTICS + HIDDEN SPENDING UI VERIFICATION\n';
  report += '===========================================================\n';
  report += `Environment: local-mode Vite dev server :${PORT} (Supabase env blanked), headless Edge over CDP,\n`;
  report += 'browser-local seeded data only, no network, no DB, no AI.\n';
  report += `Result: ${passed}/${results.length} checks passed\n\n`;
  for (const r of results) report += `${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ' — ' + r.detail : ''}\n`;
  report += '\n--- captured card text (S1 populated) ---\n';
  for (const [k, v] of Object.entries(dumps)) report += `\n[${k}]\n${String(v).slice(0, 1200)}\n`;
  report += '\n--- console errors ---\n' + (consoleErrors.join('\n') || 'none') + '\n';
  report += '\n--- page exceptions ---\n' + (pageErrors.join('\n') || 'none') + '\n';
  report += '\n--- failed requests ---\n' + (failedRequests.join('\n') || 'none') + '\n';
  report += '\n--- requests observed ---\n' + [...new Set(allRequests)].join('\n') + '\n';
  fs.writeFileSync(path.join(__dirname, 'p4c5-report.txt'), report);
  fs.writeFileSync(path.join(__dirname, 'p4c5-results.json'), JSON.stringify({ results, consoleErrors, pageErrors, failedRequests, allRequests: [...new Set(allRequests)], dumps }, null, 2));
  return passed;
}

main()
  .then(() => {
    const passed = writeReport();
    const failed = results.filter((r) => !r.pass);
    console.log(`\n=== ${passed}/${results.length} checks passed ===`);
    if (failed.length > 0) console.log('FAILED:\n' + failed.map((f) => ' - ' + f.name + ' :: ' + f.detail).join('\n'));
    process.exitCode = failed.length === 0 ? 0 : 1;
  })
  .catch((err) => {
    record('harness completed without throwing', false, err && err.message);
    writeReport();
    console.error('HARNESS ERROR:', err);
    cleanup(ownedProfileDir, ownedDevChild);
    process.exitCode = 2;
  });

