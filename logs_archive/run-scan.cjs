// Secret scan: report FILE + LINE NUMBER + PATTERN NAME only. Never print values.
const fs = require('node:fs'), path = require('node:path');
const roots = ['src', 'supabase/functions', '.env.example'];
const patterns = [
  { name: 'AI_PROVIDER_API_KEY_VALUE?', re: /AI_PROVIDER_API_KEY\s*=\s*["']?[^"'\s]+["']?/ },
  { name: 'GEMINI_KEY_LITERAL?', re: /AIza[0-9A-Za-z_\-]{10,}/ },
  { name: 'VITE_SECRET?', re: /VITE_[A-Z_]*(KEY|SECRET)[A-Z_]*\s*=\s*\S+/ },
  { name: 'SERVICE_ROLE_IN_SRC?', re: /service[_-]?role/i },
  { name: 'OPENAI_SK?', re: /sk-(proj-)?[A-Za-z0-9]{10,}/ },
];
const out = [];
out.push('secret scan ' + new Date().toISOString());
function walk(dir) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', 'dist', '.git'].includes(e.name)) continue;
      walk(p);
    } else if (/\.(ts|tsx|js|cjs|mjs|json|toml|example|md)$/.test(e.name)) {
      let lines = [];
      try { lines = fs.readFileSync(p, 'utf8').split('\n'); } catch { continue; }
      lines.forEach((ln, i) => {
        // skip known-safe doc lines that only mention variable NAMES
        const isDoc = /never|template|variable names only|example|supabase secrets set AI_PROVIDER_API_KEY=<secret>/i.test(ln);
        for (const pat of patterns) {
          if (pat.re.test(ln)) {
            const safe = isDoc ? ' (doc/template mention, no value)' : '';
            // never echo the line content, only location + pattern
            out.push(`${p}:${i + 1}: matched ${pat.name}${safe}`);
          }
        }
      });
    }
  }
}
for (const r of roots) walk(path.join(__dirname, r));
// .env.local: key names only, never values
try {
  const raw = fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8');
  const keys = raw.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => l.split('=')[0]);
  out.push('.env.local key names only: ' + keys.join(', '));
  const bad = keys.filter(k => /SECRET|SERVICE_ROLE|AI_PROVIDER_API_KEY|GEMINI/i.test(k));
  out.push(bad.length ? 'WARNING keys that must not be in .env.local: ' + bad.join(', ') : '.env.local: no server-secret key names present (good)');
} catch { out.push('.env.local: not readable'); }
fs.writeFileSync(path.join(__dirname, 'scan-out.txt'), out.join('\n'));
console.log('scan done');
