'use strict';
const net = require('node:net');
// One request/response per connection; the daemon authorises SO_PEERCRED.
function call(request, { socketPath = process.env.AGENTBOX_SESSIONS_SOCKET || '/run/agentbox-sessions/sessions.sock', timeout = 12000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let data = '';
    const finish = (err, value) => { socket.destroy(); err ? reject(err) : resolve(value); };
    socket.setTimeout(timeout, () => finish(new Error('session plane timeout')));
    socket.on('error', reject);
    socket.on('connect', () => socket.write(JSON.stringify(request) + '\n'));
    socket.on('data', chunk => {
      data += chunk;
      if (data.length > 4 * 1024 * 1024) return finish(new Error('session plane response too large'));
      if (!data.includes('\n')) return;
      try {
        const reply = JSON.parse(data.slice(0, data.indexOf('\n')));
        if (!reply.ok) return finish(new Error(reply.error || 'session plane refused request'));
        finish(null, reply);
      } catch (err) { finish(err); }
    });
    socket.on('end', () => { if (!data.includes('\n')) finish(new Error('session plane closed without a response')); });
  });
}
module.exports = { call };
