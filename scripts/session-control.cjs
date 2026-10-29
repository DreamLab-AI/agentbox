#!/usr/bin/env node
'use strict';
// Restricted voice-controller surface: fleet reads and coordinator sends only.
const fs = require('node:fs');
const client = require(fs.existsSync('/opt/agentbox/config/session-plane/client.cjs')
  ? '/opt/agentbox/config/session-plane/client.cjs' : '../config/session-plane/client.cjs');
async function main() {
  const [op, text, ...extra] = process.argv.slice(2);
  if (op === 'list' && text === undefined) {
    console.log(JSON.stringify(await client.call({ op: 'list' })));
  } else if (op === 'send' && text && extra.length === 0) {
    await client.call({ op: 'send', slug: 'tab0', text });
    console.log('sent to coordinator');
  } else {
    throw new Error('Usage: session-control.cjs list | send <text>');
  }
}
main().catch(err => { console.error(err.message); process.exitCode = 1; });
