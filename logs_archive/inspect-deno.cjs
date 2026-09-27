// READ-ONLY inspection for the Deno/Edge Function editor-diagnostics task.
// Writes findings to inspect-deno-out.txt. Modifies nothing.
const fs = require('fs');
const { spawnSync } = require('child_process');
const out = [];
const say = (t) => out.push(t === undefined ? '' : String(t));
const readIf = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const head = (p, n) => { const c = readIf(p); return c === null ? '(absent)' : c.split(/\r?\n/).slice(0, n).join('\n'); };

say('=== supabase/functions/finwise-copilot listing ===');
try { say(fs.readdirSync('supabase/functions/finwise-copilot').join('\n')); } catch (e) { say('ERR ' + e.message); }
say('');
say('=== supabase/ listing ===');
try { say(fs.readdirSync('supabase').join('\n')); } catch (e) { say('ERR ' + e.message); }
say('');
say('=== root listing ===');
try { say(fs.readdirSync('.').join('\n')); } catch (e) { say('ERR ' + e.message); }
say('');
say('=== index.ts lines 1-40 ===');
say(head('supabase/functions/finwise-copilot/index.ts', 40));
say('');
say('=== scope.ts lines 1-28 ===');
say(head('supabase/functions/finwise-copilot/scope.ts', 28));
say('');
for (const p of [
  'supabase/config.toml',
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.node.json',
  '.vscode/settings.json',
  '.vscode/extensions.json',
  'deno.json',
  'deno.jsonc',
  'import_map.json',
  'supabase/deno.json',
  'supabase/import_map.json',
  'supabase/functions/deno.json',
  'supabase/functions/import_map.json',
  'supabase/functions/finwise-copilot/deno.json',
  'supabase/functions/finwise-copilot/import_map.json',
]) {
  const c = readIf(p);
  say(`=== ${p}${c === null ? ' (absent)' : ''} ===`);
  if (c !== null) say(c);
  say('');
}
const userSettings = readIf(process.env.APPDATA + '/Code/User/settings.json');
say('=== VS Code user settings.json (read-only peek) ===');
if (userSettings === null) say('(absent or unreadable)');
else {
  const lines = userSettings.split(/\r?\n/).filter((l) => /deno/i.test(l));
  say(lines.length ? lines.join('\n') : '(no deno-related lines)');
}
say('');
say('=== git status --porcelain ===');
const gs = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8', shell: true });
say(`exit=${gs.status}`);
say(((gs.stdout || '') + (gs.stderr || '')).split(/\r?\n/).slice(0, 60).join('\n'));
say('');
say('=== git diff --stat HEAD (tail 40) ===');
const gd = spawnSync('git', ['diff', '--stat', 'HEAD'], { encoding: 'utf8', shell: true });
say(`exit=${gd.status}`);
say((gd.stdout || '').split(/\r?\n/).slice(-40).join('\n'));
say('');
say('=== deno --version ===');
const dv = spawnSync('deno', ['--version'], { encoding: 'utf8', shell: true });
say(`exit=${dv.status}`);
say((dv.stdout || dv.stderr || '').split(/\r?\n/).slice(0, 5).join('\n'));
say('');
say('=== VS Code extensions containing deno/supabase ===');
const ext = spawnSync('code', ['--list-extensions'], { encoding: 'utf8', shell: true });
say(`exit=${ext.status}`);
const extLines = (ext.stdout || '').split(/\r?\n/).filter((l) => /deno|supabase/i.test(l));
say(extLines.length ? extLines.join('\n') : '(no deno/supabase extensions found or CLI unavailable)');
if (ext.status !== 0) say((ext.stderr || '').split(/\r?\n/).slice(0, 3).join('\n'));

fs.writeFileSync('inspect-deno-out.txt', out.join('\n') + '\n');
console.log('inspect-deno-out.txt written');
