const { execSync } = require('child_process');

console.log('Attempting to run npx supabase...');

try {
  console.log('Running: npx --yes supabase --version');
  const result = execSync('npx --yes supabase --version', { 
    encoding: 'utf8', 
    timeout: 120000,
    stdio: 'pipe'
  });
  console.log('Supabase CLI version:', result.trim());
} catch (e) {
  console.log('Error executing supabase:', e.message);
  if (e.stdout) console.log('Stdout:', e.stdout.toString());
  if (e.stderr) console.log('Stderr:', e.stderr.toString());
  process.exit(1);
}
