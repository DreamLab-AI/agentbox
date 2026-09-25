#!/usr/bin/env node
// Skill-routing hook for agentbox (ADR-2091; egress accepted by ADR-2090).
// Registered on UserPromptSubmit by the entrypoint when
// [skills.routing].router = "jev" and .hook = true. The gate is inlined into
// the registered command as AGENTBOX_SKILL_ROUTER=jev, so with the gate off the
// hook is not registered at all (byte-identical-when-off), and if it is ever
// run without that env it does nothing.
//
// Puts the user's turn to System One as ONE Choice over every routable skill
// registered for Claude Code (skills/registered-skills.txt; the whole baked tree
// only if that manifest is unreadable) and injects the pick as context. The
// model then loads the skill (or not) — this hook recommends, it never dispatches.
//
// Protocol: reads hook JSON from stdin. A pick is written to stdout in the only
// shape Claude Code honours, {"hookSpecificOutput":{"hookEventName":
// "UserPromptSubmit","additionalContext":"…"}} (lib/hook-output.cjs); nothing to
// inject means no stdout at all. Always exit 0.
// Fail-open: any error, timeout, 429/529 or `none` pick → exit 0, no injection.
// The always-loaded descriptions and /route are the normal path in that case.

'use strict';

const path = require('path');
const lib = require(path.join(__dirname, 'lib', 'skill-route.cjs'));
const { emitContext } = require(path.join(__dirname, 'lib', 'hook-output.cjs'));

async function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const c of process.stdin) input += c;
  let hook = {};
  try { hook = JSON.parse(input || '{}'); } catch { return; }
  const prompt = hook.userInput || hook.prompt || '';
  const cfg = lib.config(process.env);
  const r = await lib.route(prompt, cfg, { retries: 0, registeredOnly: true });
  const session = cfg.labelLog && hook.session_id
    ? require('crypto').createHash('sha256').update(String(hook.session_id)).digest('hex').slice(0, 12)
    : undefined;
  lib.appendLog(cfg, { ...r, consumer: 'hook', session });
  await emitContext(lib.formatContext(r, cfg));
}

main().catch(() => {}).finally(() => { process.exitCode = 0; });
