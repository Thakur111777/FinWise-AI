const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const r = spawnSync('node', ['fix-import.cjs'], { encoding: 'utf8', timeout: 60000, cwd: __dirname });
fs.writeFileSync(
  'fix-import-out.txt',
  `exit=${r.status}\nSTDOUT:\n${r.stdout || ''}\nSTDERR:\n${r.stderr || ''}\n`,
);
console.log('done exit=' + r.status);
