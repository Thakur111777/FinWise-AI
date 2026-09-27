const { spawnSync } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const SUPA = 'C:\\Users\\Prashant Chadha\\AppData\\Roaming\\npm\\node_modules\\supabase\\dist\\supabase.js';
function qrun(exe, args, ms) {
  const r = spawnSync(exe, args, { encoding: 'utf8', timeout: ms, cwd: __dirname });
  return { status: r.status, tail: (String(r.stdout || '') + '\n' + String(r.stderr || '')).slice(-2500) };
}
function sh(args, ms) {
  const r = spawnSync('node', [SUPA, ...args], { encoding: 'utf8', timeout: ms, cwd: __dirname });
  const clean = (s) => String(s || '').replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '');
  return { status: r.status, out: clean(r.stdout).slice(0, 3000), err: clean(r.stderr).slice(0, 2000) };
}
const qout = ['final closure fresh ' + new Date().toISOString()];
const l = qrun('node', ['node_modules/eslint/bin/eslint.js', '.'], 240000);
qout.push(`eslint exit=${l.status}\n${l.tail.slice(-500)}`);
const t = qrun('node', ['node_modules/typescript/bin/tsc', '-b'], 240000);
qout.push(`tsc -b exit=${t.status}\n${t.tail.slice(-300)}`);
const v = qrun('node', ['node_modules/vite/bin/vite.js', 'build'], 240000);
qout.push(`vite build exit=${v.status}\n${v.tail.slice(-600)}`);
const a = qrun('node', ['verify_phase3a.mjs'], 60000);
qout.push(`verify_phase3a exit=${a.status}\n${a.tail.slice(-400)}`);
const b = qrun('node', ['verify_phase3b.mjs'], 60000);
qout.push(`verify_phase3b exit=${b.status}\n${b.tail.slice(-400)}`);
const s = qrun('node', ['run-scan.cjs'], 60000);
qout.push(`run-scan exit=${s.status}\n${s.tail.slice(-200)}`);
try { qout.push('--- scan-out.txt ---\n' + fs.readFileSync(path.join(__dirname, 'scan-out.txt'), 'utf8').slice(0, 1600)); } catch { qout.push('scan-out unreadable'); }
const fl = sh(['functions', 'list', '--project-ref', 'dufiwbxkvhorrjmckrwm'], 90000);
qout.push('FUNCTIONS status=' + fl.status); qout.push(fl.out);
const sl = sh(['secrets', 'list', '--project-ref', 'dufiwbxkvhorrjmckrwm'], 90000);
const names = (sl.out.match(/[A-Z][A-Z0-9_]{2,}/g) || []).filter((vv, i, arr) => arr.indexOf(vv) === i);
qout.push('SECRETS status=' + sl.status); qout.push('secret names: ' + names.join(', '));
const has = (n) => names.includes(n);
qout.push(`AI_PROVIDER present=${has('AI_PROVIDER')} AI_MODEL present=${has('AI_MODEL')} AI_PROVIDER_API_KEY present=${has('AI_PROVIDER_API_KEY')}`);
async function main() {
  try {
    const r = await fetch('https://dufiwbxkvhorrjmckrwm.supabase.co/functions/v1/finwise-copilot', { method: 'OPTIONS' });
    qout.push('endpoint OPTIONS status=' + r.status);
  } catch (e) { qout.push('endpoint OPTIONS error=' + String(e).slice(0, 120)); }
  try {
    const r = await fetch('https://dufiwbxkvhorrjmckrwm.supabase.co/functions/v1/finwise-copilot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'hi', history: [] }) });
    qout.push('endpoint unauth POST status=' + r.status);
    qout.push('body: ' + (await r.text()).slice(0, 300));
  } catch (e) { qout.push('endpoint POST error=' + String(e).slice(0, 120)); }
  fs.writeFileSync(path.join(__dirname, 'final-closure-fresh.txt'), qout.join('\n'));
  console.log('final closure fresh written');
}
main();