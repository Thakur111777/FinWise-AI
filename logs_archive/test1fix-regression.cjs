const { spawnSync } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
function run(exe, args, ms) {
  const r = spawnSync(exe, args, { encoding: 'utf8', timeout: ms, cwd: __dirname });
  return { status: r.status, tail: (String(r.stdout || '') + '\n' + String(r.stderr || '')).slice(-1200) };
}
const out = ['test1fix regression ' + new Date().toISOString()];
const v = run('node', ['node_modules/vite/bin/vite.js', 'build'], 240000);
out.push(`vite build exit=${v.status}\n${v.tail}`);
const a = run('node', ['verify_phase3a.mjs'], 60000);
out.push(`verify_phase3a exit=${a.status}\n${a.tail.slice(-400)}`);
const b = run('node', ['verify_phase3b.mjs'], 60000);
out.push(`verify_phase3b exit=${b.status}\n${b.tail.slice(-400)}`);
const s = run('node', ['run-scan.cjs'], 60000);
out.push(`run-scan exit=${s.status}\n${s.tail.slice(-200)}`);
try { out.push('--- scan-out.txt ---\n' + fs.readFileSync(path.join(__dirname, 'scan-out.txt'), 'utf8').slice(0, 1600)); } catch { out.push('scan-out unreadable'); }
fs.writeFileSync(path.join(__dirname, 'test1fix-regression.txt'), out.join('\n'));
console.log('test1fix regression written');
