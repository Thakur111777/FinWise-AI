const { spawnSync } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const r = spawnSync('node', ['node_modules/typescript/bin/tsc', '-b'], { encoding: 'utf8', timeout: 240000, cwd: __dirname });
fs.writeFileSync(path.join(__dirname, 'tsc-out.txt'), `exit=${r.status}\nSTDOUT:\n${String(r.stdout || '').slice(-3000)}\nSTDERR:\n${String(r.stderr || '').slice(-3000)}\n`);
console.log('tsc done exit=' + r.status);
