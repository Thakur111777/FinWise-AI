// Runs the official Deno type-check against the Edge Function sources via the
// npx-cached official `deno` npm shim (no project dependency added).
// READ-ONLY with respect to source code. Writes denocheck-out.txt.
const { spawnSync } = require('child_process');
const fs = require('fs');
const out = [];
const clean = (s) => String(s || '').replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '');
const run = (label, args, timeout) => {
  const r = spawnSync('npx', args, { encoding: 'utf8', shell: true, timeout });
  out.push(`=== ${label} ===`, `exit=${r.status}`, clean((r.stdout || '') + (r.stderr || '')).split('\n').slice(-60).join('\n'), '');
  return r;
};
const v = run('npx deno --version', ['-y', 'deno', '--version'], 600000);
if (v.status === 0) {
  run(
    'deno check index.ts (config: supabase/functions/deno.json)',
    ['-y', 'deno', 'check', '--config', 'supabase/functions/deno.json', 'supabase/functions/finwise-copilot/index.ts'],
    600000,
  );
  run(
    'deno check scope.ts',
    ['-y', 'deno', 'check', '--config', 'supabase/functions/deno.json', 'supabase/functions/finwise-copilot/scope.ts'],
    600000,
  );
} else {
  out.push('(deno CLI unavailable via npx — type-check skipped, tooling limitation reported)');
}
fs.writeFileSync('denocheck-out.txt', out.join('\n') + '\n');
console.log('denocheck done');
