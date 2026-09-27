const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Supabase CLI for Windows x64
const url = 'https://github.com/supabase/supabase/releases/download/v2.35.0/supabase-windows-amd64.exe';
const destDir = path.join(process.env.LOCALAPPDATA, 'supabase');
const dest = path.join(destDir, 'supabase.exe');

console.log('Creating directory:', destDir);
fs.mkdirSync(destDir, { recursive: true });

console.log('Downloading Supabase CLI from:', url);
const file = fs.createWriteStream(dest);

https.get(url, (response) => {
  if (response.statusCode === 200) {
    response.pipe(file);
    file.on('finish', () => {
      file.close();
      console.log('Downloaded to:', dest);
      console.log('Version check:');
      try {
        const version = execSync(`"${dest}" --version`, { encoding: 'utf8' }).trim();
        console.log('Supabase CLI version:', version);
      } catch (e) {
        console.error('Failed to get version:', e.message);
      }
    });
  } else {
    console.error('Failed to download:', response.statusCode);
    process.exit(1);
  }
}).on('error', (err) => {
  console.error('Download error:', err.message);
  process.exit(1);
});
