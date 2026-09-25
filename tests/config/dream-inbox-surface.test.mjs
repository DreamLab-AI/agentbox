#!/usr/bin/env node
// dream-inbox-surface.test.mjs — ADR-2115: the hook points at the governance
// panel with a count; it never relays item bodies and never writes the inbox.
//
// Run: node tests/config/dream-inbox-surface.test.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.resolve(HERE, '../../config/hooks/dream-inbox-surface.cjs');

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failures.push(`${name}${detail ? `: ${detail}` : ''}`); console.log(`  FAIL ${name}${detail ? `: ${detail}` : ''}`); }
}

// The context Claude Code actually reads: hookSpecificOutput.additionalContext.
const ctxOf = (out) => out && out.hookSpecificOutput && out.hookSpecificOutput.additionalContext;

function run(inbox, prompt = 'hello') {
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify({ prompt }),
    env: { ...process.env, DREAM_INBOX_PATH: inbox, DREAM_GOVERNANCE_URL: 'https://example.test/gov' },
    encoding: 'utf8',
  });
  return JSON.parse(r.stdout.trim());
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dream-hook-'));
const inbox = path.join(dir, 'dream-inbox.json');
const items = [
  { id: 'a1', kind: 'question', repo: 'r', night_id: 'n', date: 'd', text: 'SECRET BODY TEXT', status: 'open', answer: '', last_surfaced: 0 },
  { id: 'a2', kind: 'alert', repo: 'r', night_id: 'n', date: 'd', text: 'alert body', status: 'open', answer: '', last_surfaced: 0 },
  { id: 'a3', kind: 'alert', repo: 'r', night_id: 'n', date: 'd', text: 'done', status: 'answered', answer: 'x', last_surfaced: 0 },
];
fs.writeFileSync(inbox, JSON.stringify(items));
const before = fs.readFileSync(inbox, 'utf8');

const machine = run(inbox, '<task-notification>\n<task-id>x</task-id>');
check('harness-generated turn gets no pointer', ctxOf(machine) === undefined);
check('skipping a machine turn does not burn the window', !fs.existsSync(`${inbox}.surfaced`));

const first = run(inbox);
check('pointer uses the hookSpecificOutput shape',
  first.hookSpecificOutput && first.hookSpecificOutput.hookEventName === 'UserPromptSubmit');
check('no top-level additionalContext (Claude Code ignores it)', first.additionalContext === undefined);
check('first turn injects a pointer', typeof ctxOf(first) === 'string');
check('pointer counts open items only', /\b2 dream-machine decisions await you\b/.test(ctxOf(first) || ''), ctxOf(first));
check('pointer names the panel URL', (ctxOf(first) || '').includes('https://example.test/gov'));
check('no item body is relayed', !(ctxOf(first) || '').includes('SECRET BODY TEXT'));
check('inbox file is not modified', fs.readFileSync(inbox, 'utf8') === before);

const second = run(inbox);
check('rate-limited within the window', ctxOf(second) === undefined);

fs.writeFileSync(`${inbox}.surfaced`, '0');
fs.writeFileSync(inbox, JSON.stringify(items.map((i) => ({ ...i, status: 'answered' }))));
const none = run(inbox);
check('nothing open → no injection', ctxOf(none) === undefined);

fs.writeFileSync(inbox, 'not json');
check('corrupt inbox fails open', ctxOf(run(inbox)) === undefined);

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
