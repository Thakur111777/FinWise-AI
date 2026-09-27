// This script deploys the finwise-copilot Edge Function using the bundled ESM file
// via the Supabase Management API
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const projectRef = 'dufiwbxkvhorrjmckrwm';
const functionName = 'finwise-copilot';
const functionPath = path.join(__dirname, 'supabase', 'functions', 'finwise-copilot');

// Get the access token by using a temporary method
// We'll try to extract it from the supabase CLI internals
const cliPath = path.join(process.env.APPDATA, 'npm', 'node_modules', 'supabase', 'dist', 'supabase.js');

// First, bundle the function with esbuild
const esbuild = require(path.join(functionPath, 'node_modules', 'esbuild'));

console.log('=== Step 1: Bundling function with esbuild ===');

esbuild.build({
  entryPoints: [path.join(functionPath, 'index.ts')],
  bundle: true,
  platform: 'neutral',
  format: 'esm',
  outfile: path.join(functionPath, 'function.mjs'),
  write: true,
  legalComments: 'external',
  external: ['https://esm.sh/@supabase/supabase-js@2/dist/module']
}).then(() => {
  console.log('Bundled successfully');
  
  // Read the bundled file
  const bundledCode = fs.readFileSync(path.join(functionPath, 'function.mjs'), 'utf8');
  console.log('Bundled file size:', bundledCode.length, 'bytes');
  
  // Now we need to deploy. Since we can't easily get the token, let's
  // try using the supabase CLI with a pipe
  console.log('=== Step 2: Deploying via Supabase CLI ===');
  
  try {
    // Use the CLI to deploy - it should use the cached session
    execSync(`supabase functions deploy ${functionName} --use-api --yes --project-ref ${projectRef} --import-map ${path.join(functionPath, 'import_map.json')}`, {
      cwd: __dirname,
      encoding: 'utf8',
      timeout: 300000,
      stdio: 'inherit'
    });
    console.log('=== Deployment succeeded! ===');
    process.exit(0);
  } catch (err) {
    console.error('Deployment failed:', err.message);
    if (err.stdout) console.error('STDOUT:', err.stdout.toString().substring(0, 2000));
    if (err.stderr) console.error('STDERR:', err.stderr.toString().substring(0, 2000));
    process.exit(1);
  }
}).catch(err => {
  console.error('Bundling error:', err.message);
  process.exit(1);
});