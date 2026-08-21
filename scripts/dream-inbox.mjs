#!/usr/bin/env node
// Dream-inbox CLI — list / answer / dismiss operator items queued by the
// nightly dream-engine. The surfacing hook (dream-inbox-surface.cjs) injects
// open items into sessions; this is the write path back.
//
//   node dream-inbox.mjs list [--all]
//   node dream-inbox.mjs answer <id> "<answer text>"
//   node dream-inbox.mjs dismiss <id>
//
// Answers stay in the JSON (the engine's carry-over reads them and feeds the
// repo's next night). For decisions worth cross-agent recall, ALSO store them
// via mcp__claude-flow__memory_store (namespace project-state) in-session —
// this CLI deliberately does not write RuVector (MCP-only embedding rule).

import fs from 'node:fs';

const INBOX = '/home/devuser/workspace/.agentbox/dream-inbox.json';

function load() {
  try { return JSON.parse(fs.readFileSync(INBOX, 'utf8')); } catch { return []; }
}
function save(items) {
  fs.writeFileSync(INBOX, JSON.stringify(items, null, 2));
}

const [cmd, id, ...rest] = process.argv.slice(2);
const items = load();

switch (cmd) {
  case 'list': {
    const all = id === '--all';
    const shown = items.filter((i) => all || i.status === 'open');
    if (shown.length === 0) { console.log(all ? 'inbox empty' : 'no open items'); break; }
    for (const i of shown) {
      console.log(`[${i.id}] ${i.status.padEnd(9)} ${i.kind.padEnd(8)} ${i.repo.padEnd(20)} ${i.date}  ${i.text}${i.answer ? `\n    ↳ answer: ${i.answer}` : ''}`);
    }
    break;
  }
  case 'answer': {
    const item = items.find((i) => i.id === id && i.status === 'open');
    if (!item) { console.error(`no open item ${id}`); process.exit(1); }
    const answer = rest.join(' ').trim();
    if (!answer) { console.error('answer text required'); process.exit(1); }
    item.answer = answer;
    item.status = 'answered';
    save(items);
    console.log(`answered ${id} — will feed ${item.repo}'s next dream night`);
    break;
  }
  case 'dismiss': {
    const item = items.find((i) => i.id === id && i.status === 'open');
    if (!item) { console.error(`no open item ${id}`); process.exit(1); }
    item.status = 'dismissed';
    save(items);
    console.log(`dismissed ${id}`);
    break;
  }
  default:
    console.error('usage: dream-inbox.mjs list [--all] | answer <id> "<text>" | dismiss <id>');
    process.exit(2);
}
