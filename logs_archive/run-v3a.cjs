const { spawnSync } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const r = spawnSync('node', ['verify_phase3a.mjs'], { encoding: 'utf8', timeout: 60000, cwd: __dirname });
fs.writeFileSync(path.join(__dirname, 'v3a-fresh.txt'), `exit=${r.status}\n${String(r.stdout || '').slice(-1500)}\n${String(r.stderr || '').slice(-500)}\n`);
console.log('v3a done exit=' + r.status);
