const { execSync } = require('child_process');
const path = require('path');

const supabaseCli = path.join(process.env.APPDATA, 'npm', 'node_modules', 'supabase', 'dist', 'supabase.js');

console.log('Starting deployment of finwise-copilot...');
console.log('Using CLI:', supabaseCli);

try {
  const result = execSync(`node "${supabaseCli}" functions deploy finwise-copilot --use-api --yes --log-level info`, {
    encoding: 'utf8',
    timeout: 300000,
    stdio: 'pipe'
  });
  console.log('Deployment result:');
  console.log(result);
  process.exit(0);
} catch (e) {
  console.log('Error:', e.message);
  if (e.stdout) console.log('Stdout:', e.stdout.toString());
  if (e.stderr) console.log('Stderr:', e.stderr.toString());
  process.exit(1);
}
