/**
 * EXACT diagnostic enumeration via the real tsserver protocol.
 *
 * VS Code's built-in TypeScript support is tsserver; files not covered by any
 * tsconfig (supabase/functions/**, test-scope.ts) fall into tsserver's
 * "inferred project". This probe spawns the project's OWN tsserver binary,
 * opens each target file exactly as VS Code would, and captures the
 * semantic diagnostics tsserver publishes — i.e. the exact Problems-panel
 * entries, with codes and counts. No source is changed; @ts-ignore is not
 * involved; nothing is silenced.
 *
 * Usage: node tsserver-probe.cjs [before|after]
 * Writes tsserver-probe-<mode>-out.txt.
 */
const { spawn } = require('node:child_process');
const path = require('node:path');

const MODE = process.argv[2] || 'before';
const FILTER = process.argv[3] || '';
const SERVER = 'node_modules/typescript/lib/tsserver.js';
const FILES = [
  path.resolve('test-scope.ts'),
  path.resolve('supabase/functions/finwise-copilot/index.ts'),
].filter((file) => file.includes(FILTER));

const server = spawn(process.execPath, [SERVER, '--disableAutomaticTypingAcquisition'], {
  cwd: process.cwd(),
  stdio: ['pipe', 'pipe', 'pipe'],
});

let buffer = '';
let seq = 0;
const events = [];
const waiters = [];
let stderrTail = '';

server.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  // tsserver frames messages as: Content-Length: N\r\n\r\n{json}
  for (;;) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) break;
    const header = buffer.slice(0, headerEnd);
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) { buffer = buffer.slice(headerEnd + 4); continue; }
    const length = Number(match[1]);
    if (buffer.length < headerEnd + 4 + length) break;
    const body = buffer.slice(headerEnd + 4, headerEnd + 4 + length);
    buffer = buffer.slice(headerEnd + 4 + length);
    let message;
    try { message = JSON.parse(body); } catch { continue; }
    if (message.type === 'event') {
      events.push(message);
      for (let i = waiters.length - 1; i >= 0; i -= 1) {
        if (waiters[i].predicate(message)) {
          waiters[i].resolve(message);
          waiters.splice(i, 1);
        }
      }
    }
  }
});
server.stderr.on('data', (chunk) => { stderrTail = (stderrTail + chunk.toString()).slice(-800); });

function send(command, args) {
  seq += 1;
  const payload = JSON.stringify({ seq, type: 'request', command, arguments: args ?? {} });
  server.stdin.write(`Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`);
  return seq;
}

function waitFor(predicate, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${label}`)), timeoutMs);
    waiters.push({
      predicate,
      resolve: (message) => { clearTimeout(timer); resolve(message); },
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function formatDiagnostics(label, body) {
  const lines = [`=== ${label} semantic diagnostics: ${body.diagnostics.length} ===`];
  for (const d of body.diagnostics) {
    const line = d.start?.line ?? '?';
    const cat = d.category ?? '?';
    const code = d.code ?? '?';
    const text = String(d.text ?? '').replace(/\s+/g, ' ').slice(0, 160);
    lines.push(`  L${line} ${cat} TS${code}: ${text}`);
  }
  return lines.join('\n');
}

(async () => {
  const out = [`# tsserver exact-diagnostics probe — mode=${MODE}`, `# tsserver: ${SERVER}`];
  try {
    send('configure', { preferences: { includeInlayParameterNameHints: 'none' }, watchOptions: {} });
    // Mirror VS Code: inferred-project options are configured up-front.
    send('compilerOptionsForInferredProjects', {
      options: { allowJs: true, module: 'commonjs', target: 'es2020' },
    });
    await sleep(500);

    for (const file of FILES) {
      try {
        const semantic = waitFor(
          (m) => m.event === 'semanticDiag' && m.body && m.body.file === file,
          240000,
          `semanticDiag ${path.basename(file)}`,
        );
        send('open', { file, projectRootVersion: 'probe' });
        const message = await semantic;
        out.push(formatDiagnostics(path.relative(process.cwd(), file), message.body));
      } catch (fileError) {
        out.push(`  SKIP ${path.basename(file)}: ${fileError.message}`);
      }
    }
    out.push('PROBE-DONE');
  } catch (error) {
    out.push(`PROBE-ERROR: ${error.message}`);
    if (stderrTail) out.push(`tsserver stderr tail: ${stderrTail}`);
  }
  send('exit', {});
  require('node:fs').writeFileSync(`tsserver-probe-${MODE}-out.txt`, out.join('\n') + '\n');
  console.log(`probe ${MODE} done`);
  setTimeout(() => process.exit(0), 300);
})();
