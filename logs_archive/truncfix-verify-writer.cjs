const { spawnSync } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const SUPA = 'C:\\Users\\Prashant Chadha\\AppData\\Roaming\\npm\\node_modules\\supabase\\dist\\supabase.js';
function sh(args, ms) {
  const r = spawnSync('node', [SUPA, ...args], { encoding: 'utf8', timeout: ms, cwd: __dirname });
  const clean = (s) => String(s || '').replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '');
  return { status: r.status, out: clean(r.stdout).slice(0, 3000), err: clean(r.stderr).slice(0, 1000) };
}
const out = ['truncfix verify ' + new Date().toISOString()];
const fl = sh(['functions', 'list', '--project-ref', 'dufiwbxkvhorrjmckrwm'], 90000);
out.push('FUNCTIONS status=' + fl.status); out.push(fl.out);
async function main() {
  try {
    const r = await fetch('https://dufiwbxkvhorrjmckrwm.supabase.co/functions/v1/finwise-copilot', { method: 'OPTIONS' });
    out.push('endpoint OPTIONS status=' + r.status);
  } catch (e) { out.push('endpoint OPTIONS error=' + String(e).slice(0, 120)); }
  try {
    const r = await fetch('https://dufiwbxkvhorrjmckrwm.supabase.co/functions/v1/finwise-copilot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'hi', history: [] }) });
    out.push('endpoint unauth POST status=' + r.status);
    out.push('body: ' + (await r.text()).slice(0, 300));
  } catch (e) { out.push('endpoint POST error=' + String(e).slice(0, 120)); }
  fs.writeFileSync(path.join(__dirname, 'truncfix-verify.txt'), out.join('\n'));
  console.log('truncfix verify written');
}
main();