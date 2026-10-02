// scripts/dream-inbox.mjs remind — a standing reminder reaches the governance panel through the
// engine's own inbox (ADR-2115): an open "question" item whose id is the engine's short_hash of
// "reminder:<text>", queued once, ever. A throwaway inbox (DREAM_INBOX); the live one is untouched.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const CLI = path.resolve(__dirname, '../../scripts/dream-inbox.mjs');

function withInbox(items, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dream-inbox-remind-'));
  const inbox = path.join(dir, 'dream-inbox.json');
  fs.writeFileSync(inbox, JSON.stringify(items));
  try {
    const run = (...args) => execFileSync('node', [CLI, ...args], { env: { ...process.env, DREAM_INBOX: inbox }, encoding: 'utf8' });
    return fn(run, () => JSON.parse(fs.readFileSync(inbox, 'utf8')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('remind queues one open question with the engine-compatible id, once', () => {
  withInbox([{ id: 'aaaaaaaa', kind: 'alert', repo: 'agentbox', night_id: 'n', date: '2026-10-01', text: 't', status: 'open', answer: '' }], (run, read) => {
    run('remind', 'agentbox', 'x');
    const items = read();
    assert.equal(items.length, 2, 'the existing item is kept and one is added');
    const r = items[1];
    // FNV-1a 64 of "reminder:x" folded to 32 bits, as services/dream-engine/src/inbox.rs short_hash
    assert.equal(r.id, '7bb3e8fb');
    assert.deepEqual({ kind: r.kind, repo: r.repo, night_id: r.night_id, status: r.status, text: r.text },
      { kind: 'question', repo: 'agentbox', night_id: 'reminder', status: 'open', text: 'x' });
    assert.match(run('remind', 'agentbox', 'x'), /already queued \(open\)/);
    assert.equal(read().length, 2, 'the same reminder is never queued twice');
  });
});

test('an answered or dismissed reminder stays decided', () => {
  withInbox([{ id: '7bb3e8fb', kind: 'question', repo: 'agentbox', night_id: 'reminder', date: '2026-10-01', text: 'x', status: 'dismissed', answer: '' }], (run, read) => {
    assert.match(run('remind', 'agentbox', 'x'), /already queued \(dismissed\)/);
    assert.equal(read().length, 1);
  });
});
