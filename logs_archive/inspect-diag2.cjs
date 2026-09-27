// Enumeration + correct-tooling check for the remaining editor diagnostics.
// - Lists installed VS Code extensions (before/after a CORRECT singular-flag
//   install of the Deno extension; the previous attempt used the invalid
//   plural flag `--install-extensions`, which passes through to Electron).
// - Enumerates the exact tsserver-visible constructs in index.ts / test-scope.ts
//   (Deno global usages, remote/relative import specifiers, TLA usage).
// - Approximates the inferred-project tsc behaviour to reproduce the 6 + 3
//   diagnostics (classic resolution / commonjs module = inferred defaults).
// Writes everything to inspect-diag2-out.txt. Modifies nothing in the app.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const clean = (s) => String(s || '').replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '');
const out = [];

function run(label, cmd, args, timeoutMs) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: true, timeout: timeoutMs || 240000 });
  out.push(
    `=== ${label} exit=${r.status} ===\n--stdout--\n${clean(r.stdout).slice(-2500)}\n--stderr--\n${clean(r.stderr).slice(-1200)}`,
  );
  return r;
}

// 1. Extension state: list -> correct install -> list again.
run('EXT-LIST-BEFORE', 'code', ['--list-extensions'], 60000);
run('EXT-INSTALL-DENO', 'code', ['--install-extension', 'denoland.vscode-deno', '--force'], 180000);
run('EXT-LIST-AFTER', 'code', ['--list-extensions'], 60000);

// 2. tsserver-visible constructs (counts only, no source printed).
const idx = fs.readFileSync('supabase/functions/finwise-copilot/index.ts', 'utf8');
const tst = fs.readFileSync('test-scope.ts', 'utf8');
const count = (re, text) => (text.match(re) || []).length;
out.push(
  [
    '=== CONSTRUCT COUNTS ===',
    `index.ts  Deno.<x> occurrences          : ${count(/\bDeno\.[A-Za-z]+/g, idx)}`,
    `index.ts  jsr: import specifiers        : ${count(/from 'jsr:/g, idx)}`,
    `index.ts  ./scope import specifier      : ${count(/from '\.\/scope/g, idx)}`,
    `index.ts  Deno.env.get( occurrences     : ${count(/Deno\.env\.get\(/g, idx)}`,
    `index.ts  Deno.serve( occurrences       : ${count(/Deno\.serve\(/g, idx)}`,
    `test-scope.ts  'node:*' import specifiers: ${count(/from 'node:/g, tst)}`,
    `test-scope.ts  top-level await statements: ${count(/^await /m, tst)}`,
    `test-scope.ts  process. usages           : ${count(/\bprocess\./g, tst)}`,
  ].join('\n'),
);

// 3. Approximate the inferred-project diagnostics with CLI tsc.
//    Inferred-project defaults: no Deno types, classic-ish resolution for
//    non-'bundler' module targets => node:/jsr: specifiers + relative .js->.ts
//    rewriting fail, and TLA fails under a commonjs-flavoured module target.
run(
  'TSC-SIM-INDEX (expected: 4x TS2304 Deno + 1x TS2307 jsr + 1x TS2307 ./scope.js)',
  'npx',
  ['tsc', '--noEmit', '--skipLibCheck', '--target', 'es2022', '--module', 'esnext', '--moduleResolution', 'classic', '--lib', 'es2022,dom', 'supabase/functions/finwise-copilot/index.ts'],
  180000,
);
run(
  'TSC-SIM-TESTSCOPE (expected: 1x TLA + 2x TS2307 node:*)',
  'npx',
  ['tsc', '--noEmit', '--skipLibCheck', '--target', 'es2022', '--module', 'commonjs', '--moduleResolution', 'classic', '--lib', 'es2022', 'test-scope.ts'],
  180000,
);

fs.writeFileSync('inspect-diag2-out.txt', out.join('\n') + '\n');
console.log('inspect-diag2 done');
