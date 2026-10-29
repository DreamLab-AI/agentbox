#!/usr/bin/env node
// Live acceptance against the running daemon. Canned arithmetic proves a reply
// is generated (the expected output is absent from the submitted prompt).
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const { call } = createRequire(import.meta.url)('/opt/agentbox/config/session-plane/client.cjs');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const rows = (await call({ op: 'list' })).sessions;
const roundtrip = process.argv.includes('--roundtrip');
const results = await Promise.all(rows.filter(s => s.origin === 'seed').map(async s => {
  if (!s.present || !['busy', 'idle'].includes(s.state.state)) return { slug: s.slug, ok: false, reason: s.label };
  if (!roundtrip || s.slug === 'router') return { slug: s.slug, ok: true, roundtrip: false };
  if (s.state.state === 'busy') return { slug: s.slug, ok: false, reason: 'busy; acceptance will not interrupt existing work' };
  const n = 1000 + Math.floor(Math.random() * 8000);
  await call({ op: 'send', slug: s.slug, text: `Reply with only the word PONG, a hyphen, and the number ${n} plus one. Do not use tools or edit files.` });
  const end = Date.now() + 180000;
  while (Date.now() < end) {
    const pane = execFileSync('tmux', ['capture-pane', '-p', '-t', s.name, '-S', '-80'], { encoding: 'utf8' });
    if (pane.includes(`PONG-${n + 1}`)) return { slug: s.slug, ok: true, roundtrip: true };
    await sleep(1000);
  }
  return { slug: s.slug, ok: false, reason: 'no generated reply within 180s' };
}));
console.log(JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
if (results.some(r => !r.ok)) process.exitCode = 1;
