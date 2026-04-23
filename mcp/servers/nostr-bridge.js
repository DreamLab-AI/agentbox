#!/usr/bin/env node

const http = require('http');

const port = Number(process.env.NOSTR_BRIDGE_PORT || 9740);
const relays = (process.env.NOSTR_RELAYS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const managementPort = Number(process.env.MANAGEMENT_API_PORT || 9090);

const server = http.createServer((req, res) => {
  const body = JSON.stringify({
    status: 'ok',
    relayCount: relays.length,
    relays,
    managementApi: `http://127.0.0.1:${managementPort}`,
    mode: 'bridge-scaffold'
  });
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(body);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`nostr-bridge listening on ${port}`);
  if (relays.length === 0) {
    console.log('nostr-bridge: no relays configured');
    return;
  }
  console.log(`nostr-bridge: configured relays: ${relays.join(', ')}`);
});
