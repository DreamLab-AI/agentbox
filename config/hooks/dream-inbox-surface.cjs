#!/usr/bin/env node
// Dream-inbox surfacing hook (UserPromptSubmit).
//
// The nightly dream-engine has no session with the operator; this hook is the
// bridge. When the engine (or the harvest script) queues a question or alert
// in ~/workspace/.agentbox/dream-inbox.json, the next user turn — in ANY Claude
// session, whatever its context — gets the open items injected as additional
// context, with instructions for the model to relay them and record answers
// via /dream answer. That makes the self-improvement loop part of working
// praxis instead of a log nobody reads.
//
// Rate limiting: an item is surfaced at most once per RESURFACE_HOURS (per
// item, tracked via last_surfaced in the inbox file), and at most
// MAX_PER_TURN items per turn. Fail-open: any error → continue, no injection.

'use strict';

const fs = require('fs');

const INBOX = '/home/devuser/workspace/.agentbox/dream-inbox.json';
const RESURFACE_HOURS = 4;
const MAX_PER_TURN = 2;

function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { input += c; });
  process.stdin.on('end', () => {
    try {
      const items = JSON.parse(fs.readFileSync(INBOX, 'utf8'));
      if (!Array.isArray(items)) return exit();
      const now = Math.floor(Date.now() / 1000);
      const due = items.filter((i) =>
        i && i.status === 'open' &&
        now - (i.last_surfaced || 0) > RESURFACE_HOURS * 3600
      ).slice(0, MAX_PER_TURN);
      if (due.length === 0) return exit();

      for (const i of due) i.last_surfaced = now;
      fs.writeFileSync(INBOX, JSON.stringify(items, null, 2));

      const lines = due.map((i) =>
        `- [${i.id}] (${i.kind}, ${i.repo}, ${i.date}) ${i.text}`
      );
      const ctx =
        '[DREAM INBOX] The nightly self-improvement loop has ' +
        `${due.length} open item(s) for the operator. After answering the ` +
        'user’s actual request, relay these questions verbatim and ask ' +
        'for a decision. Record any answer the user gives by running: ' +
        'node /home/devuser/workspace/project/agentbox/scripts/dream-inbox.mjs ' +
        'answer <id> "<answer text>" — answered items feed the next ' +
        'night’s hypothesis carry-over. (User can also say "dismiss <id>".)\n' +
        lines.join('\n');

      process.stdout.write(JSON.stringify({
        result: 'continue',
        additionalContext: ctx,
      }) + '\n');
    } catch {
      exit();
    }
  });
}

function exit() {
  process.stdout.write(JSON.stringify({ result: 'continue' }) + '\n');
}

main();
