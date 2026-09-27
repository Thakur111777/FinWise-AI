const { spawnSync } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const r = spawnSync('node', ['node_modules/vite/bin/vite.js', 'build'], { encoding: 'utf8', timeout: 240000, cwd: __dirname });
fs.writeFileSync(path.join(__dirname, 'v-fresh.txt'), `vite exit=${r.status}\nSTDOUT:\n${String(r.stdout || '').slice(-2000)}\nSTDERR:\n${String(r.stderr || '').slice(-2000)}\n`);
console.log('vite done exit=' + r.status);
