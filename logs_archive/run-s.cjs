const { spawnSync } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const r = spawnSync('node', ['run-scan.cjs'], { encoding: 'utf8', timeout: 60000, cwd: __dirname });
const scan = fs.readFileSync(path.join(__dirname, 'scan-out.txt'), 'utf8');
fs.writeFileSync(path.join(__dirname, 's-fresh.txt'), `run-scan exit=${r.status}\n${String(r.stdout || '').slice(-300)}\n--- scan-out.txt ---\n${scan.slice(0, 2000)}\n`);
console.log('scan done exit=' + r.status);
