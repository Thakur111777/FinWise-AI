const { spawnSync } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const out = ['final regression ' + new Date().toISOString()];
function cmd(exe, args, ms, label) {
  const r = spawnSync(exe, args, { encoding: 'utf8', timeout: ms, cwd: __dirname });
  const tail = (String(r.stdout || '') + '\n' + String(r.stderr || '')).slice(-2500);
  out.push(`--- ${label} exit=${r.status} ---\n` + tail);
}
cmd('npm', ['run', 'build'], 240000, 'npm run build');
cmd('npm', ['run', 'lint'], 180000, 'npm run lint');
cmd('node', ['verify_phase3a.mjs'], 60000, 'verify_phase3a');
cmd('node', ['verify_phase3b.mjs'], 60000, 'verify_phase3b');
cmd('node', ['run-scan.cjs'], 60000, 'run-scan');
try { out.push('--- scan-out.txt ---\n' + fs.readFileSync(path.join(__dirname, 'scan-out.txt'), 'utf8').slice(0, 2000)); } catch (e) { out.push('scan-out unreadable'); }
fs.writeFileSync(path.join(__dirname, 'regression-out.txt'), out.join('\n'));
console.log('regression written');
