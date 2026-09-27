const fs = require('fs');
const path = require('path');
const homeDir = process.env.HOME || process.env.USERPROFILE || '';
const tracesPath = path.join(homeDir, '.supabase', 'traces');

if (fs.existsSync(tracesPath)) {
  const files = fs.readdirSync(tracesPath);
  for (const file of files) {
    const filePath = path.join(tracesPath, file);
    const data = fs.readFileSync(filePath, 'utf8');
    const lines = data.split('\n').filter(l => l.trim());
    console.log(`File: ${file}, Lines: ${lines.length}`);
    // Check last 50 lines for any API usage
    const lastLines = lines.slice(-50);
    for (const line of lastLines) {
      if (line.toLowerCase().includes('api') || line.toLowerCase().includes('token')) {
        console.log('Relevant line:', line.substring(0, 200));
      }
    }
  }
} else {
  console.log('No traces directory found at:', tracesPath);
}