/**
 * Phase 3B verification (static, no network, no credentials).
 *
 * Cross-checks the authentication + persistence integration that Phase 3B
 * added on top of Phase 3A:
 *   [1] authentication layer files and provider wiring
 *   [2] route protection wiring
 *   [3] authentication UI wiring (existing AuthPage reused)
 *   [4] repository selection in the FinancialDataProvider (one source of truth)
 *   [5] repository boundary — supabase.from() stays inside services/supabase
 *   [6] auth centralisation — supabase.auth stays inside the auth layer
 *   [7] security scan — no privileged keys/credentials in frontend code
 *   [8] accounts surface — the Accounts screen is reachable from navigation
 *   [9] account UX consolidation — Accounts is the single management surface,
 *       and the Dashboard/Transactions only link to it
 *
 * Never prints credential values — only statuses and verdicts.
 * Exit code 0 = all checks passed.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';

let failures = 0;
const fail = (msg) => { failures += 1; console.log(`  FAIL  ${msg}`); };
const pass = (msg) => console.log(`  ok    ${msg}`);

const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null);
const src = (rel) => read(`src/${rel}`) ?? '';
const normalise = (path) => path.replace(/\\/g, '/');

/* [1] authentication layer -------------------------------------------------- */
console.log('[1] Authentication layer');
for (const file of [
  'src/features/auth/authContextCore.ts',
  'src/features/auth/authContext.tsx',
  'src/features/auth/useAuth.ts',
  'src/features/auth/RequireAuth.tsx',
]) {
  if (read(file) !== null) pass(`${file} exists`);
  else fail(`${file} missing`);
}

const authProvider = src('features/auth/authContext.tsx');
const mainTsx = src('main.tsx');
const providerWired =
  /<AuthProvider>/.test(mainTsx) &&
  mainTsx.indexOf('<AuthProvider>') < mainTsx.indexOf('<FinancialDataProvider>');
if (providerWired) pass('AuthProvider mounted above FinancialDataProvider in main.tsx');
else fail('AuthProvider not mounted above FinancialDataProvider in main.tsx');

if (/getSession\(\)/.test(authProvider) && /onAuthStateChange/.test(authProvider)) {
  pass('provider restores the session and subscribes to auth state changes');
} else fail('provider missing getSession() restore or onAuthStateChange subscription');

if (/persistSession:\s*true/.test(src('services/supabase/client.ts'))) {
  pass('supabase client persists sessions (refresh restores the session)');
} else fail('supabase client does not persist sessions');

/* [2] route protection ------------------------------------------------------ */
console.log('[2] Route protection');
const appTsx = src('App.tsx');
if (/<RequireAuth>/.test(appTsx) && /<AppShell \/>/.test(appTsx)) {
  pass('AppShell route wrapped in RequireAuth in App.tsx');
} else fail('AppShell route not wrapped in RequireAuth');

const requireAuth = src('features/auth/RequireAuth.tsx');
if (/initializing/.test(requireAuth) && /\/login/.test(requireAuth)) {
  pass('guard waits for session initialisation before redirecting');
} else fail('guard does not handle the initialising state before redirecting');

if (/isLocalMode/.test(requireAuth)) {
  pass('guard keeps Phase 2 local mode working when Supabase is unconfigured');
} else fail('guard breaks Phase 2 local mode (no isLocalMode bypass)');

/* [3] authentication UI ------------------------------------------------------ */
console.log('[3] Authentication UI');
const authPage = src('pages/AuthPage.tsx');
if (/signInWithPassword/.test(authPage)) pass('sign-in wired through the auth provider');
else fail('AuthPage does not call signInWithPassword');
if (/signUpWithPassword/.test(authPage)) pass('sign-up wired through the auth provider');
else fail('AuthPage does not call signUpWithPassword');
if (/needsEmailConfirmation/.test(authPage)) pass('email-confirmation outcome handled honestly');
else fail('email-confirmation outcome not handled');
if (!/supabase\.auth/.test(authPage)) pass('AuthPage never touches supabase.auth directly (centralised)');
else fail('AuthPage calls supabase.auth directly — auth must stay centralised');

const sidebar = src('components/layout/Sidebar.tsx');
const settings = src('pages/SettingsPage.tsx');
if (/signOut\(\)/.test(sidebar) && /signOut\(\)/.test(settings)) {
  pass('sign-out available in the sidebar and settings');
} else fail('sign-out control missing in sidebar or settings');

/* [4] repository selection --------------------------------------------------- */
console.log('[4] Repository selection');
const dataContext = src('features/dashboard/financialDataContext.tsx');
if (/createSupabaseRepository\(/.test(dataContext)) pass('SupabaseRepository factory used by the provider');
else fail('provider does not reference createSupabaseRepository');
if (/LocalStorageRepository/.test(dataContext)) pass('LocalStorageRepository kept as the unconfigured fallback');
else fail('LocalStorageRepository fallback missing');
if (/key=\{persistenceIdentity\}/.test(dataContext)) pass('store remounts per persistence identity (sign-in/out/user switch)');
else fail('store does not remount per persistence identity');
if (/refreshFromRepository/.test(dataContext)) pass('mutations re-hydrate from the repository (id adoption)');
else fail('no post-mutation refresh from the repository');
if (/signedOutConfigured/.test(dataContext)) pass('signed-out configured app holds an honest empty state');
else fail('signed-out configured behaviour not guarded');

/* [5] repository boundary ----------------------------------------------------- */
console.log('[5] Repository boundary');
const fromViolations = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(ts|tsx)$/.test(entry)) {
      const text = readFileSync(full, 'utf8');
      if (/\.from\(/.test(text) && !normalise(full).includes('src/services/supabase/')) {
        fromViolations.push(normalise(full));
      }
    }
  }
};
walk('src');
if (fromViolations.length === 0) pass('supabase.from() appears only inside src/services/supabase');
else fail(`direct supabase.from() outside the repository layer: ${fromViolations.join(', ')}`);

/* [6] auth centralisation ------------------------------------------------------ */
console.log('[6] Auth centralisation');
const authViolations = [];
const walkAuth = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) walkAuth(full);
    else if (/\.(ts|tsx)$/.test(entry)) {
      const text = readFileSync(full, 'utf8');
      const allowed = normalise(full).includes('src/features/auth/') || normalise(full).includes('src/services/supabase/');
      if (/\.auth\./.test(text) && !allowed) authViolations.push(normalise(full));
    }
  }
};
walkAuth('src');
if (authViolations.length === 0) pass('supabase.auth is called only inside the auth layer / supabase services');
else fail(`scattered supabase.auth calls: ${authViolations.join(', ')}`);

/* [7] security scan -------------------------------------------------------------- */
console.log('[7] Security scan');
const privilegedPattern = /service_role|service-role|SUPABASE_SERVICE_ROLE|AI_PROVIDER_API_KEY|DATABASE_URL|postgres:\/\//i;
/** Strip block comments and whole-line comments so documentation that merely
 * WARNS about privileged keys is not mistaken for credential usage. */
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
const privilegedHits = [];
const walkSecrets = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) walkSecrets(full);
    else if (/\.(ts|tsx|js|css|html)$/.test(entry)) {
      const text = stripComments(readFileSync(full, 'utf8'));
      if (privilegedPattern.test(text) && !normalise(full).includes('src/services/supabase/config.ts')) {
        privilegedHits.push(normalise(full));
      }
    }
  }
};
walkSecrets('src');
if (privilegedHits.length === 0) pass('no privileged key/credential references in frontend source (config.ts guard allowed)');
else fail(`privileged references in frontend code: ${privilegedHits.join(', ')}`);

const configTs = src('services/supabase/config.ts');
if (/decodeKeyRole/.test(configTs) && /service_role/.test(configTs)) {
  pass('config boundary refuses a service_role key instead of shipping it');
} else fail('config boundary lost its service_role refusal');

const envExample = read('.env.example') ?? '';
const exampleViteVars = [...envExample.matchAll(/^(VITE_[A-Z0-9_]+)=/gm)].map((m) => m[1]);
if (exampleViteVars.length === 2 && exampleViteVars.includes('VITE_SUPABASE_URL') && exampleViteVars.includes('VITE_SUPABASE_ANON_KEY')) {
  pass('.env.example declares exactly the two client-safe variables');
} else fail(`.env.example VITE_ variables unexpected: ${exampleViteVars.join(', ')}`);

const envLocal = read('.env.local');
if (envLocal !== null) {
  // Variable NAMES only — values are never read or printed here.
  const localNames = [...envLocal.matchAll(/^\s*([A-Za-z0-9_]+)\s*=/gm)].map((m) => m[1]);
  const badNames = localNames.filter((name) => privilegedPattern.test(name));
  if (badNames.length === 0) pass('.env.local contains no privileged variable names');
  else fail(`.env.local has privileged variable names: ${badNames.join(', ')}`);
  const viteNames = localNames.filter((name) => name.startsWith('VITE_'));
  if (viteNames.every((name) => name === 'VITE_SUPABASE_URL' || name === 'VITE_SUPABASE_ANON_KEY')) {
    pass('.env.local VITE_ variables are only the two client-safe ones');
  } else fail(`.env.local has unexpected VITE_ variables: ${viteNames.join(', ')}`);
} else {
  console.log('  note  .env.local not present (Supabase runs unconfigured/local mode)');
}

const gitignore = read('.gitignore') ?? '';
if (/\.env\.\*/.test(gitignore) && /!\.env\.example/.test(gitignore)) {
  pass('.gitignore ignores .env files while keeping the names-only template');
} else fail('.gitignore does not properly exclude .env files');

/* [8] accounts surface ------------------------------------------------------- */
// The Financial Core has always supported accounts; this section makes sure the
// Accounts screen stays reachable from navigation and keeps talking only to the
// repository-backed provider (no localStorage, no direct Supabase access).
console.log('[8] Accounts surface');
const routesConfig = src('config/routes.ts');
const accountsPage = src('pages/AccountsPage.tsx');
const mobileNav = src('components/layout/MobileNav.tsx');

if (/key:\s*'accounts'[\s\S]*?path:\s*'\/accounts'/.test(routesConfig)) {
  pass('navigation configuration exposes Accounts at /accounts');
} else fail('Accounts is missing from src/config/routes.ts');

if (/import \{ AccountsPage \}/.test(appTsx) && /path="\/accounts"\s+element=\{<AccountsPage\s*\/>\}/.test(appTsx)) {
  pass('/accounts route renders AccountsPage inside the protected app shell');
} else fail('/accounts route is not wired to AccountsPage in App.tsx');

if (/accounts:\s*WalletCards/.test(sidebar) && /accounts:\s*WalletCards/.test(mobileNav)) {
  pass('Accounts has an icon in the desktop sidebar and the mobile navigation');
} else fail('Accounts icon missing from the sidebar or mobile navigation');

if (accountsPage.length > 0 && /actions\.createAccount\(/.test(accountsPage) && /actions\.updateAccount\(/.test(accountsPage)) {
  pass('Accounts UI creates/edits accounts only through provider actions');
} else fail('Accounts UI does not use the provider actions for create/update');

if (accountsPage.length > 0 && !/localStorage|supabase\.from\(/.test(accountsPage)) {
  pass('Accounts UI never touches localStorage or Supabase directly');
} else fail('Accounts UI bypasses the repository boundary');

/* [9] account UX consolidation ------------------------------------------------ */
// Accounts is the canonical account-management surface. The Dashboard keeps a
// read-only summary card and Transactions keeps its empty state — both only LINK
// to /accounts, so there is exactly one place that creates or edits an account.
console.log('[9] Account UX consolidation');
const overviewPage = src('pages/OverviewPage.tsx');
const transactionsPage = src('pages/TransactionsPage.tsx');

if (/<Link\s+to="\/accounts"/.test(overviewPage)) {
  pass('Dashboard account card links to the canonical /accounts route');
} else fail('Dashboard does not link to /accounts');

if (/<Link\s+to="\/accounts"/.test(transactionsPage)) {
  pass('Transactions empty state links to the canonical /accounts route');
} else fail('Transactions does not link to /accounts');

if (/Account balances/.test(overviewPage) && /<EmptyState/.test(overviewPage)) {
  pass('Dashboard keeps the read-only Account balances summary card');
} else fail('Dashboard Account balances summary card is missing');

const mutatingPages = [];
for (const entry of readdirSync('src/pages')) {
  const text = src(`pages/${entry}`) ?? '';
  if (/actions\.(createAccount|updateAccount|archiveAccount|unarchiveAccount)\(/.test(text)) {
    mutatingPages.push(entry);
  }
}
if (mutatingPages.length === 1 && mutatingPages[0] === 'AccountsPage.tsx') {
  pass('AccountsPage.tsx is the only page that mutates accounts (no duplicate management UI)');
} else fail(`account mutations found in unexpected pages: ${mutatingPages.join(', ') || 'none'}`);

const formOwners = [];
for (const entry of readdirSync('src/pages')) {
  const text = src(`pages/${entry}`) ?? '';
  if (/function AccountFormModal|const AccountFormModal/.test(text)) formOwners.push(entry);
}
if (formOwners.length === 1 && formOwners[0] === 'AccountsPage.tsx') {
  pass('the account form exists only in AccountsPage.tsx');
} else fail(`account form defined in unexpected pages: ${formOwners.join(', ') || 'none'}`);

if (/import \{ appRoutes \}/.test(sidebar) && /import \{ appRoutes \}/.test(mobileNav)) {
  pass('sidebar and mobile navigation share the single routes configuration');
} else fail('navigation does not reuse the shared routes configuration');

/* summary -------------------------------------------------------------------- */
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exitCode = failures === 0 ? 0 : 1;