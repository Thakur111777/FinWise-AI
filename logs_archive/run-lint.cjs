const { spawnSync } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const out = path.join(__dirname, 'lint-out.txt');
const r = spawnSync('node', ['node_modules/eslint/bin/eslint.js', '.'], { encoding: 'utf8', timeout: 300000, cwd: __dirname });
fs.writeFileSync(out, `lint exit=${r.status} err=${r.error ? String(r.error) : 'none'}\nSTDOUT:\n${String(r.stdout || '').slice(-4000)}\nSTDERR:\n${String(r.stderr || '').slice(-4000)}\n`);
