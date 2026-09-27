// Decisive diagnostics-removal checks (no npx — execution policy blocks npx.ps1):
//  1. tsconfig.node.json project type-checks cleanly with test-scope.ts included.
//  2. listFilesOnly proves test-scope.ts is inside the compiled file set.
//  3. Deno VS Code extension presence (the piece tsserver cannot substitute).
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const TSC = path.join(__dirname, 'node_modules', 'typescript', 'bin', 'tsc');
const clean = (s) => String(s || '').replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '');
const lines = [];

function run(label, cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 240000, cwd: __dirname, ...opts });
  lines.push(`=== ${label} === exit=${r.status}`);
  if (r.stdout) lines.push(clean(r.stdout).slice(0, 4000));
  if (r.stderr) lines.push('STDERR:\n' + clean(r.stderr).slice(0, 2500));
  return r;
}

// 1. The node TS project (vite.config.ts + test-scope.ts) must type-check with
//    zero errors — this is exactly what tsserver reports for included files.
run('tsc -p tsconfig.node.json --noEmit', process.execPath, [TSC, '-p', 'tsconfig.node.json', '--noEmit']);

// 2. Prove test-scope.ts is part of the project file set (was: inferred project).
const lfo = spawnSync(process.execPath, [TSC, '-p', 'tsconfig.node.json', '--listFilesOnly'], {
  encoding: 'utf8', timeout: 240000, cwd: __dirname,
});
lines.push('=== listFilesOnly (filtered) ===');
lines.push(...clean(lfo.stdout).split('\n').filter((l) => /test-scope\.ts$|vite\.config\.ts$/.test(l.trim())));
lines.push(`listFilesOnly exit=${lfo.status}`);

// 3. Deno language server extension presence (handles supabase/functions/**).
run('code --list-extensions', 'code', ['--list-extensions'], { shell: true });

fs.writeFileSync(path.join(__dirname, 'diag-final-out.txt'), lines.join('\n') + '\n');
console.log('diag-final done');
