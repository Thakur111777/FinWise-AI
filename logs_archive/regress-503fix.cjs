const { spawnSync } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
function qrun(exe, args, ms) {
  const r = spawnSync(exe, args, { encoding: 'utf8', timeout: ms, cwd: __dirname });
  return { status: r.status, tail: (String(r.stdout || '') + '\n' + String(r.stderr || '')).slice(-1200) };
}
const qout = ['regress-503fix ' + new Date().toISOString()];
const t = qrun('node', ['node_modules/typescript/bin/tsc', '-b'], 240000);
qout.push(`tsc -b exit=${t.status}\n${t.tail.slice(-300)}`);
const v = qrun('node', ['node_modules/vite/bin/vite.js', 'build'], 240000);
qout.push(`vite build exit=${v.status}\n${v.tail.slice(-500)}`);
const a = qrun('node', ['verify_phase3a.mjs'], 60000);
qout.push(`verify_phase3a exit=${a.status}\n${a.tail.slice(-300)}`);
const b = qrun('node', ['verify_phase3b.mjs'], 60000);
qout.push(`verify_phase3b exit=${b.status}\n${b.tail.slice(-300)}`);
const s = qrun('node', ['run-scan.cjs'], 60000);
qout.push(`run-scan exit=${s.status}\n${s.tail.slice(-200)}`);
try { qout.push('--- scan-out.txt ---\n' + fs.readFileSync(path.join(__dirname, 'scan-out.txt'), 'utf8').slice(0, 1600)); } catch { qout.push('scan-out unreadable'); }
fs.writeFileSync(path.join(__dirname, 'regress-503fix.txt'), qout.join('\n'));
console.log('regress 503fix written');