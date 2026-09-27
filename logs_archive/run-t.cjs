const { spawnSync } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
function qrun(exe, args, ms, outFile, head) {
  const r = spawnSync(exe, args, { encoding: 'utf8', timeout: ms, cwd: __dirname });
  fs.writeFileSync(path.join(__dirname, outFile), `${head} exit=${r.status}\nSTDOUT:\n${String(r.stdout || '').slice(-2500)}\nSTDERR:\n${String(r.stderr || '').slice(-2500)}\n`);
  console.log(`${head} done exit=` + r.status);
}
qrun('node', ['node_modules/typescript/bin/tsc', '-b'], 240000, 't-fresh.txt', 'tsc');
