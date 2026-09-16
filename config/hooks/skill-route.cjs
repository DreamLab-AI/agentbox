#!/usr/bin/env node
// Skill-routing hook for agentbox (ADR-2091; egress accepted by ADR-2090).
// Registered on UserPromptSubmit by the entrypoint when
// [skills.routing].router = "jev" and .hook = true. The gate is inlined into
// the registered command as AGENTBOX_SKILL_ROUTER=jev, so with the gate off the
// hook is not registered at all (byte-identical-when-off), and if it is ever
// run without that env it does nothing.
//
// Puts the user's turn to System One as ONE Choice over every routable skill's
// description and injects the pick as additionalContext. The model then loads
// the skill (or not) — this hook recommends, it never dispatches.
//
// Protocol: reads hook JSON from stdin, writes JSON to stdout.
// Exit 0 = continue (with optional additionalContext injection).
// Fail-open: any error, timeout, 429/529 or `none` pick → exit 0, no injection.
// The always-loaded descriptions and /route are the normal path in that case.

'use strict';

const path = require('path');
const lib = require(path.join(__dirname, 'lib', 'skill-route.cjs'));

function emit(additionalContext) {
  const out = { result: 'continue' };
  if (additionalContext) out.additionalContext = additionalContext;
  process.stdout.write(JSON.stringify(out) + '\n');
}

async function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const c of process.stdin) input += c;
  let hook = {};
  try { hook = JSON.parse(input || '{}'); } catch { emit(''); return; }
  const prompt = hook.userInput || hook.prompt || '';
  const cfg = lib.config(process.env);
  const r = await lib.route(prompt, cfg, { retries: 0 });
  lib.appendLog(cfg, { ...r, consumer: 'hook' });
  emit(lib.formatContext(r));
}

main().catch(() => emit(''));
