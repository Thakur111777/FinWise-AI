const { spawnSync } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const out = path.join(__dirname, 'verify-out.txt');
fs.writeFileSync(out, 'verify start ' + new Date().toISOString() + '\n');
for (const f of ['verify_phase3a.mjs', 'verify_phase3b.mjs']) {
  const r = spawnSync('node', [f], { encoding: 'utf8', timeout: 120000, cwd: __dirname });
  fs.appendFileSync(out, `\n--- ${f} exit=${r.status} ---\n${String(r.stdout || '').slice(-2500)}\n${String(r.stderr || '').slice(-1500)}\n`);
}
fs.appendFileSync(out, 'verify end ' + new Date().toISOString() + '\n');
