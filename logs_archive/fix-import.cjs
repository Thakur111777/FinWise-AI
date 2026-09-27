const fs = require('node:fs');
const p = 'supabase/functions/finwise-copilot/index.ts';
let s = fs.readFileSync(p, 'utf8');
const importLine = "import { classifyFinancialIntent } from './scope.ts';";
// Remove any previously misplaced copy of the import (added above section-19).
while (s.includes(importLine)) s = s.replace(importLine + '\n\n\n', '').replace(importLine + '\n\n', '').replace(importLine + '\n', '');
// Insert directly under the existing supabase-js import block (line 1-2).
const anchor = "import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';";
if (!s.startsWith("import { createClient }")) throw new Error('unexpected file head');
s = s.replace(anchor, anchor + '\n' + importLine);
fs.writeFileSync(p, s);
console.log('occurrences:', s.split(importLine).length - 1);
console.log('head:', JSON.stringify(s.slice(0, 200)));

