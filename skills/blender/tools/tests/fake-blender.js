'use strict';
// Minimal fake BlenderMCP socket server for the tool tests.
// mode: 'ok'        reply to execute_code; code containing "import bpy" is NOT run (reply "launched 1 fake"),
//                   anything else is run with the local python3 so /proc checks are real
//       'close'     accept, then close with nothing sent (what the proxy does when the sidecar is down)
//       'partial'   send half a JSON reply, then close
//       'flaky'     close-with-nothing for the first `failFirst` requests, then behave as 'ok'
const net = require('net');
const { spawnSync } = require('child_process');

function start(mode = 'ok', opts = {}) {
  const state = { requests: 0, codes: [] };
  const server = net.createServer((sock) => {
    let buf = '';
    sock.on('error', () => {});
    sock.on('data', (d) => {
      buf += d;
      let msg; try { msg = JSON.parse(buf); } catch (_) { return; }
      buf = '';
      state.requests++; state.codes.push(msg.params.code);
      if (mode === 'close') return sock.destroy();
      if (mode === 'partial') { sock.write('{"stat'); return setTimeout(() => sock.destroy(), 50); }
      if (mode === 'flaky' && state.requests <= (opts.failFirst || 1)) return sock.destroy();
      const code = msg.params.code;
      let out;
      if (code.includes('import bpy')) out = 'launched 1 fake';
      else out = spawnSync('python3', ['-c', code], { encoding: 'utf8' }).stdout;
      sock.write(JSON.stringify({ status: 'success', result: { result: out } }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, state, port: server.address().port, close: () => new Promise((r) => server.close(r)) })));
}
module.exports = { start };
