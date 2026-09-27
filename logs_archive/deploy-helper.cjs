const { spawn } = require('child_process');
const path = require('path');

const cliPath = path.join(process.env.APPDATA, 'npm', 'node_modules', 'supabase', 'dist', 'supabase.js');

const child = spawn('node', [cliPath, 'functions', 'deploy', 'finwise-copilot', '--use-api', '--yes', '--project-ref', 'dufiwbxkvhorrjmckrwm'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  timeout: 600000
});

let stdout = '';
let stderr = '';

child.stdout.on('data', (data) => {
  process.stdout.write(data.toString());
  stdout += data.toString();
});

child.stderr.on('data', (data) => {
  process.stderr.write(data.toString());
  stderr += data.toString();
});

child.on('error', (err) => {
  console.error('Failed to start deployment:', err.message);
  process.exit(1);
});

child.on('close', (code) => {
  console.log('');
  console.log('=== Deployment exit code:', code, '===');
  if (code === 0) {
    console.log('=== Deployment completed successfully ===');
    process.exit(0);
  } else {
    console.log('=== Deployment failed ===');
    console.log('STDOUT:', stdout);
    console.log('STDERR:', stderr);
    process.exit(code || 1);
  }
});

setTimeout(() => {
  console.log('=== Deployment timed out after 10 minutes ===');
  child.kill('SIGTERM');
  process.exit(1);
}, 600000);
