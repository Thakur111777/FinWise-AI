const { spawnSync } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const SUPA = 'C:\\Users\\Prashant Chadha\\AppData\\Roaming\\npm\\node_modules\\supabase\\dist\\supabase.js';
function sh(args, ms) {
  const r = spawnSync('node', [SUPA, ...args], { encoding: 'utf8', timeout: ms, cwd: __dirname });
  const clean = (s) => String(s || '').replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '');
  return { status: r.status, out: clean(r.stdout).slice(0, 4000), err: clean(r.stderr).slice(0, 4000) };
}
const out = ['inspect ' + new Date().toISOString()];
let r = sh(['inspect', '--help'], 30000);
out.push(`inspect --help exit=${r.status}\n${r.out}\nERR:${r.err}`);
r = sh(['inspect', 'logs', '--help'], 60000);
out.push(`inspect logs --help exit=${r.status}\n${r.out}\nERR:${r.err}`);
fs.writeFileSync(path.join(__dirname, 'diag-inspect.txt'), out.join('\n'));
console.log('inspect written');
