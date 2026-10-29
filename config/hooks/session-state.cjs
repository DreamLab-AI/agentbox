#!/usr/bin/env node
'use strict';
// Silent, bounded, fail-open. Codex notify also preserves the voice event spool.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
async function main() {
  const source = process.argv[2];
  if (source === 'codex' && process.argv.includes('--voice')) {
    const payload = process.argv.at(-1);
    spawnSync('/opt/agentbox/bin/voice-paned', ['record', '--source', 'codex', payload], { timeout: 1500, stdio: 'ignore' });
  }
  const slug = process.env.AGENTBOX_PROFILE;
  if (!slug || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(slug)) return;
  const state = source === 'UserPromptSubmit' ? 'busy' : 'idle';
  const client = require(fs.existsSync('/opt/agentbox/config/session-plane/client.cjs')
    ? '/opt/agentbox/config/session-plane/client.cjs' : '../session-plane/client.cjs');
  await client.call({ op: 'mark', slug, state }, { timeout: 1800 });
}
main().catch(() => {}).finally(() => { process.exitCode = 0; });
