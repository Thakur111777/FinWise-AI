const { spawnSync } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const out = path.join(__dirname, 'build-out.txt');
fs.writeFileSync(out, 'build start ' + new Date().toISOString() + '\n');
let r = spawnSync('node', ['node_modules/typescript/bin/tsc', '-b'], { encoding: 'utf8', timeout: 240000, cwd: __dirname });
fs.appendFileSync(out, `--- tsc -b exit=${r.status} err=${r.error ? String(r.error) : 'none'} ---\nSTDOUT:\n${String(r.stdout || '').slice(-3000)}\nSTDERR:\n${String(r.stderr || '').slice(-3000)}\n`);
if (r.status === 0) {
  r = spawnSync('node', ['node_modules/vite/bin/vite.js', 'build'], { encoding: 'utf8', timeout: 300000, cwd: __dirname });
  fs.appendFileSync(out, `--- vite build exit=${r.status} err=${r.error ? String(r.error) : 'none'} ---\nSTDOUT:\n${String(r.stdout || '').slice(-3000)}\nSTDERR:\n${String(r.stderr || '').slice(-3000)}\n`);
}
fs.appendFileSync(out, 'build end ' + new Date().toISOString() + '\n');
