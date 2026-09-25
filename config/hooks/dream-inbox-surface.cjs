#!/usr/bin/env node
// Dream-decision reminder hook (UserPromptSubmit).
//
// The nightly dream-engine publishes every open question and alert as a case
// on the forum governance panel (ADR-2115) — that panel is where the operator
// decides, and the engine reads the signed decisions back each night. This
// hook no longer relays item bodies into sessions: it adds one short pointer
// line saying how many decisions are waiting and where, so the reminder
// follows the operator into any Claude session without turning the session
// into a second inbox.
//
// Output shape: Claude Code reads UserPromptSubmit context ONLY from
// {"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":…}};
// a top-level `additionalContext` is silently ignored (verified in transcripts —
// the earlier hook never reached a model). Harness-generated turns (task
// notifications, agent messages, system reminders) are skipped, so the pointer
// lands on a turn the operator actually typed.
//
// Rate limiting: at most one pointer per RESURFACE_HOURS, tracked in a small
// sidecar stamp file next to the inbox (the inbox itself is the engine's
// working copy and is not written by this hook). Fail-open: any error →
// continue, no injection. DREAM_INBOX_PATH overrides the inbox location.

'use strict';

const fs = require('fs');

const INBOX = process.env.DREAM_INBOX_PATH || '/home/devuser/workspace/.agentbox/dream-inbox.json';
const STAMP = `${INBOX}.surfaced`;
const RESURFACE_HOURS = 4;
const PANEL = process.env.DREAM_GOVERNANCE_URL || 'https://dreamlab-ai.com/community/governance';
const MACHINE_TURN = /^<(task-notification|agent-message|system-reminder)\b/;

function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { input += c; });
  process.stdin.on('end', () => {
    try {
      let prompt = '';
      try { prompt = String(JSON.parse(input || '{}').prompt || ''); } catch { /* no payload */ }
      if (MACHINE_TURN.test(prompt.trimStart())) return exit();
      const items = JSON.parse(fs.readFileSync(INBOX, 'utf8'));
      if (!Array.isArray(items)) return exit();
      const open = items.filter((i) => i && i.status === 'open').length;
      if (open === 0) return exit();

      const now = Math.floor(Date.now() / 1000);
      let last = 0;
      try { last = Number(fs.readFileSync(STAMP, 'utf8').trim()) || 0; } catch { /* first run */ }
      if (now - last <= RESURFACE_HOURS * 3600) return exit();
      const noun = open === 1 ? 'decision awaits' : 'decisions await';
      const ctx = `[DREAM] ${open} dream-machine ${noun} you in the forum governance panel (${PANEL}).`;
      const out = JSON.stringify({
        hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: ctx },
      }) + '\n';
      // Stamp only once the pointer has actually been written out, so a failed
      // write does not suppress the next attempt for RESURFACE_HOURS.
      process.stdout.write(out, () => {
        try { fs.writeFileSync(STAMP, String(now)); } catch { /* fail-open */ }
      });
    } catch {
      exit();
    }
  });
}

function exit() {
  process.stdout.write('{}\n');
}

main();
