'use strict';
const net = require('node:net');
const out = [];
function probe(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port, timeout: 2000 });
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.on('timeout', () => { s.destroy(); resolve(false); });
  });
}
(async () => {
  out.push('port5199=' + (await probe(5199)));
  require('node:fs').writeFileSync('p4b-srvcheck.txt', out.join('\n') + '\n');
})();
