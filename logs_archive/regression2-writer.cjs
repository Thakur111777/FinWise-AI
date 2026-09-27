const { spawnSync } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const out = ['final regression2 ' + new Date().toISOString()];
function cmd(exe, args, ms, label) {
  const r = spawnSync(exe, args, { encoding: 'utf8', timeout: ms, cwd: __dirname, shell: true });
  const tail = (String(r.stdout || '') + '\n' + String(r.stderr || '')).slice(-2500);
  out.push(`--- ${label} exit=${r.status} ---\n` + tail);
}
cmd('npm', ['run', 'build'], 300000, 'npm run build');
cmd('npm', ['run', 'lint'], 300000, 'npm run lint');
fs.writeFileSync(path.join(__dirname, 'regression2-out.txt'), out.join('\n'));
console.log('regression2 written');
