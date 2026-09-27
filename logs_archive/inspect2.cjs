// Editor-diagnostics inspection: enumerate the exact tsserver-style errors
// VS Code shows for supabase/functions/finwise-copilot/index.ts (Deno runtime,
// no tsconfig coverage -> inferred project) and test-scope.ts (root, Node ESM,
// not covered by tsconfig.app/node includes). Also captures extension state,
// Deno availability, and existing deno/ts config files. Read-only inspection.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');

const out = [];
const line = (s) => out.push(String(s));
const run = (label, file, args) => {
  const r = spawnSync(file, args, { encoding: 'utf8', timeout: 300000 });
  line(`\n===== ${label} (exit=${r.status}) =====`);
  if (r.error) line(`SPAWN-ERROR: ${r.error.message}`);
  if (r.stdout && String(r.stdout).trim()) line(String(r.stdout).slice(0, 14000));
  if (r.stderr && String(r.stderr).trim()) line(`STDERR:\n${String(r.stderr).slice(0, 8000)}`);
  return r;
};

// 1. Which VS Code extensions are actually installed?
run('code --list-extensions', 'cmd.exe', ['/c', 'code', '--list-extensions']);

// 2. Is a deno binary on PATH / available via npx cache?
run('where deno', 'cmd.exe', ['/c', 'where', 'deno']);
run('npx deno --version', 'cmd.exe', ['/c', 'npx', '--yes', 'deno', '--version']);

// 3. Directory + config state
for (const d of ['supabase/functions', 'supabase/functions/finwise-copilot', '.vscode']) {
  line(`\n===== DIR ${d} =====`);
  try {
    line(fs.readdirSync(d).join('\n'));
  } catch (e) {
    line(`ERR ${e.message}`);
  }
}
for (const c of [
  'supabase/functions/deno.json',
  'supabase/functions/finwise-copilot/deno.json',
  'supabase/functions/import_map.json',
  'supabase/functions/finwise-copilot/import_map.json',
  'deno.json',
  'supabase/config.toml',
]) {
  line(`\n===== CONFIG ${c} exists=${fs.existsSync(c)} =====`);
  if (fs.existsSync(c)) line(fs.readFileSync(c, 'utf8').slice(0, 3000));
}

// 4. Reproduce the editor diagnostics.
//    Default tsc flags approximate tsserver inferred projects:
//    module=commonjs, all node_modules/@types included, strict off.
const tsc = (label, args) => run(`tsc ${label}`, 'cmd.exe', ['/c', 'npx', 'tsc', ...args]);
tsc(
  'default(index.ts) [module=commonjs implicit]',
  ['--noEmit', '--skipLibCheck', 'supabase/functions/finwise-copilot/index.ts'],
);
tsc(
  'default(test-scope.ts) [module=commonjs implicit]',
  ['--noEmit', '--skipLibCheck', 'test-scope.ts'],
);
tsc(
  'esnext(test-scope.ts) [module=esnext bundler es2022]',
  ['--noEmit', '--skipLibCheck', '--module', 'esnext', '--moduleResolution', 'bundler', '--target', 'es2022', 'test-scope.ts'],
);

fs.writeFileSync('inspect2-out.txt', out.join('\n') + '\n');
console.log('inspect2 done');
