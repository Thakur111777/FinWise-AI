const { spawnSync } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const SUPA = 'C:\\Users\\Prashant Chadha\\AppData\\Roaming\\npm\\node_modules\\supabase\\dist\\supabase.js';
const r = spawnSync('node', [SUPA, 'functions', 'deploy', 'finwise-copilot', '--use-api', '--yes', '--project-ref', 'dufiwbxkvhorrjmckrwm'], { encoding: 'utf8', timeout: 420000, cwd: __dirname });
const clean = (s) => String(s || '').replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '');
fs.writeFileSync(path.join(__dirname, 'deploy-test1fix.txt'), `exit=${r.status}\nSTDOUT:\n${clean(r.stdout).slice(-4000)}\nSTDERR:\n${clean(r.stderr).slice(-4000)}\n`);
console.log('deploy done exit=' + r.status);
