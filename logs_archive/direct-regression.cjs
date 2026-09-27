const { spawnSync } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const out = ['direct regression ' + new Date().toISOString()];
function cmd(exe, args, ms, label) {
  const r = spawnSync(exe, args, { encoding: 'utf8', timeout: ms, cwd: __dirname });
  const tail = (String(r.stdout || '') + '\n' + String(r.stderr || '')).slice(-2500);
  out.push(`--- ${label} exit=${r.status} ---\n` + tail);
}
cmd('node', ['node_modules/typescript/bin/tsc', '-b'], 240000, 'tsc -b');
cmd('node', ['node_modules/vite/bin/vite.js', 'build'], 240000, 'vite build');
cmd('node', ['node_modules/eslint/bin/eslint.js', '.'], 240000, 'eslint .');
fs.writeFileSync(path.join(__dirname, 'direct-regression-out.txt'), out.join('\n'));
console.log('direct regression written');
