const { spawnSync } = require('node:child_process');
const SUPA = 'C:\\Users\\Prashant Chadha\\AppData\\Roaming\\npm\\node_modules\\supabase\\dist\\supabase.js';
function sh(args, ms) {
  const r = spawnSync('node', [SUPA, ...args], { encoding: 'utf8', timeout: ms, cwd: __dirname });
  const clean = (s) => String(s || '').replace(/\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '');
  return { status: r.status, out: clean(r.stdout).slice(0, 2000), err: clean(r.stderr).slice(0, 2000) };
}
async function main() {
  const fs = require('node:fs'), path = require('node:path');
  const out = [];
  out.push('final check ' + new Date().toISOString());
  const fl = sh(['functions', 'list', '--project-ref', 'dufiwbxkvhorrjmckrwm'], 90000);
  out.push('FUNCTIONS status=' + fl.status); out.push(fl.out);
  const sl = sh(['secrets', 'list', '--project-ref', 'dufiwbxkvhorrjmckrwm'], 90000);
  const names = (sl.out.match(/[A-Z][A-Z0-9_]{2,}/g) || []).filter((v, i, a) => a.indexOf(v) === i);
  out.push('SECRETS status=' + sl.status); out.push('secret names: ' + names.join(', '));
  const has = (n) => names.includes(n);
  out.push(`AI_PROVIDER present=${has('AI_PROVIDER')} AI_MODEL present=${has('AI_MODEL')} AI_PROVIDER_API_KEY present=${has('AI_PROVIDER_API_KEY')}`);
  try {
    const r = await fetch('https://dufiwbxkvhorrjmckrwm.supabase.co/functions/v1/finwise-copilot', { method: 'OPTIONS' });
    out.push('endpoint OPTIONS status=' + r.status);
  } catch (e) { out.push('endpoint OPTIONS error=' + String(e).slice(0, 120)); }
  try {
    const r = await fetch('https://dufiwbxkvhorrjmckrwm.supabase.co/functions/v1/finwise-copilot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'hi', history: [] }) });
    out.push('endpoint unauth POST status=' + r.status + ' (401 = exists, 404 = missing)');
    out.push('body: ' + (await r.text()).slice(0, 200));
  } catch (e) { out.push('endpoint POST error=' + String(e).slice(0, 120)); }
  fs.writeFileSync(path.join(__dirname, 'final-check.txt'), out.join('\n'));
  console.log(out.join('\n'));
}
main();
