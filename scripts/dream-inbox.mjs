#!/usr/bin/env node
// Dream-inbox CLI — list / answer / dismiss operator items queued by the
// nightly dream-engine. BREAK-GLASS ONLY: the canonical place to decide is the
// forum governance panel ("Dream machine decisions", ADR-2115), whose signed
// decisions the engine ingests each night. Use this when the forum is down.
//
//   node dream-inbox.mjs list [--all]
//   node dream-inbox.mjs answer <id> "<answer text>"
//   node dream-inbox.mjs dismiss <id>
//   node dream-inbox.mjs remind <repo> "<text>"
//
// `remind` queues a standing reminder as an open "question" item, which the
// engine publishes to the governance panel as a kind-31402 case at the end of
// the next night, like any question a report raised (ADR-2115). Its id is the
// engine's own (FNV-1a of "reminder:<text>", services/dream-engine/src/inbox.rs
// short_hash), so the same reminder is queued once, ever: once it has been
// answered or dismissed, re-running remind does nothing.
//
// Answers stay in the JSON (the engine's carry-over reads them and feeds the
// repo's next night). For decisions worth cross-agent recall, ALSO store them
// via mcp__claude-flow__memory_store (namespace project-state) in-session —
// this CLI deliberately does not write RuVector (MCP-only embedding rule).

import fs from 'node:fs';

const INBOX = process.env.DREAM_INBOX || '/home/devuser/workspace/.agentbox/dream-inbox.json';  // override for tests

function load() {
  try { return JSON.parse(fs.readFileSync(INBOX, 'utf8')); } catch { return []; }
}
function save(items) {
  // tmp + rename: the engine reads this file at night; never let it see half a write
  fs.writeFileSync(`${INBOX}.tmp`, JSON.stringify(items, null, 2));
  fs.renameSync(`${INBOX}.tmp`, INBOX);
}
// services/dream-engine/src/inbox.rs short_hash: FNV-1a 64 over the UTF-8 bytes, folded to 32 bits
function shortHash(s) {
  let h = 0xcbf29ce484222325n;
  for (const b of Buffer.from(s, 'utf8')) { h ^= BigInt(b); h = (h * 0x100000001b3n) & 0xffffffffffffffffn; }
  return ((Number(h >> 32n) ^ Number(h & 0xffffffffn)) >>> 0).toString(16).padStart(8, '0');
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
  case 'remind': {
    const repo = id; const text = rest.join(' ').trim();
    if (!repo || !text) { console.error('usage: dream-inbox.mjs remind <repo> "<text>"'); process.exit(1); }
    const nightId = 'reminder'; const rid = shortHash(`${nightId}:${text}`);
    const have = items.find((i) => i.id === rid);
    if (have) { console.log(`reminder ${rid} is already queued (${have.status}); nothing added`); break; }
    items.push({ id: rid, kind: 'question', repo, night_id: nightId, date: new Date().toISOString().slice(0, 10), text, status: 'open', answer: '', last_surfaced: 0 });
    save(items);
    console.log(`queued reminder ${rid} for ${repo}: the next night publishes it to the governance panel`);
    break;
  }
  default:
    console.error('usage: dream-inbox.mjs list [--all] | answer <id> "<text>" | dismiss <id> | remind <repo> "<text>"');
    process.exit(2);
}
