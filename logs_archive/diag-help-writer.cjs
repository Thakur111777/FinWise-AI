const { spawnSync } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const SUPA = 'C:\\Users\\Prashant Chadha\\AppData\\Roaming\\npm\\node_modules\\supabase\\dist\\supabase.js';
function sh(args, ms) {
  const r = spawnSync('node', [SUPA, ...args], { encoding: 'utf8', timeout: ms, cwd: __dirname });
  const clean = (s) => String(s || '').replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '');
  return { status: r.status, out: clean(r.stdout).slice(0, 4000), err: clean(r.stderr).slice(0, 4000) };
}
const out = ['diag ' + new Date().toISOString()];
out.push('--- functions --help ---');
let r = sh(['functions', '--help'], 30000);
out.push(`exit=${r.status}\n${r.out}\nERR:${r.err}`);
out.push('--- functions logs --help ---');
r = sh(['functions', 'logs', '--help'], 30000);
out.push(`exit=${r.status}\n${r.out}\nERR:${r.err}`);
out.push('--- top --help ---');
r = sh(['--help'], 30000);
out.push(`exit=${r.status}\n${r.out}\nERR:${r.err}`);
fs.writeFileSync(path.join(__dirname, 'diag-help.txt'), out.join('\n'));
console.log('diag-help written');
