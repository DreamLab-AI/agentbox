#!/usr/bin/env node
'use strict';

/**
 * Consultant: codex (OpenAI Codex Rust CLI).
 *
 * Spawns the Codex CLI binary at /usr/local/bin/codex (or wherever
 * agentbox's lib/codex-binary.nix put it on the PATH). Codex's `exec`
 * subcommand takes a single prompt argument and writes its answer to
 * stdout. We pass context as a leading section in the same prompt
 * because Codex CLI does not support stdin context excerpts.
 *
 * Auth: CODEX_HOME points at the openai-user's config dir so the user-
 * isolated credential store is honoured.
 */

const fs = require('fs');
const path = require('path');
const { BaseConsultant } = require('../shared/consultant-base');
const { spawnCli } = require('../shared/spawn-cli');

const CODEX_BIN = process.env.AGENTBOX_CODEX_BIN || '/usr/local/bin/codex';
const CODEX_HOME = process.env.AGENTBOX_CODEX_HOME || '/home/openai-user/.codex';
const MODEL = process.env.AGENTBOX_CODEX_MODEL || 'gpt-5.5';

// Rough USD per 1k tokens — gpt-5.5 published rates (refresh on model bump).
const PRICE_PER_1K_PROMPT     = 0.010;
const PRICE_PER_1K_COMPLETION = 0.030;

function formatPrompt(question, context) {
  return context
    ? `# Context (excerpt provided by the coordinator)\n\n${context}\n\n---\n\n# Question\n\n${question}\n`
    : question;
}

async function callConsult({ question, context_excerpt }) {
  const prompt = formatPrompt(question, context_excerpt);
  const result = await spawnCli({
    cmd: CODEX_BIN,
    args: ['exec', '--json', '--skip-git-repo-check', '--model', MODEL, '--', prompt],
    env: {
      CODEX_HOME,
      OPENAI_API_KEY:    process.env.OPENAI_API_KEY    || '',
      OPENAI_BASE_URL:   process.env.OPENAI_BASE_URL   || '',
      AGENTBOX_AGENT_ID: 'consultant-codex',
    },
    timeout_ms: 180_000,
  });

  if (result.code !== 0) {
    throw new Error(
      `codex CLI exited ${result.code}` +
      (result.killed ? ' (killed by timeout)' : '') +
      (result.stderr ? `: ${result.stderr.slice(0, 400)}` : '')
    );
  }

  // Codex --json emits a JSONL stream. codex-cli >= 0.150 shape:
  //   {"type":"item.completed","item":{"type":"agent_message","text":"..."}}
  //   {"type":"turn.completed","usage":{"input_tokens":N,"output_tokens":M,...}}
  // Older builds emitted {"type":"final"|"message","content":"..."}. Handle
  // both; fall back to raw stdout if nothing parses. Non-JSON lines (Code Mode
  // warnings etc.) are skipped rather than aborting the whole parse.
  let response = result.stdout;
  let tokens = {};
  const messages = [];
  for (const line of result.stdout.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let obj;
    try { obj = JSON.parse(t); } catch { continue; }
    if (obj.type === 'item.completed' && obj.item && obj.item.type === 'agent_message' && obj.item.text) {
      messages.push(obj.item.text);
    } else if (obj.type === 'turn.completed' && obj.usage) {
      tokens = {
        prompt_tokens:     obj.usage.input_tokens,
        completion_tokens: obj.usage.output_tokens,
        cached_tokens:     obj.usage.cached_input_tokens,
        reasoning_tokens:  obj.usage.reasoning_output_tokens,
      };
    } else if (obj.type === 'final' || obj.type === 'message') {
      messages.push(obj.content || obj.message || '');
      if (obj.usage) tokens = obj.usage;
    }
  }
  if (messages.length) response = messages.join('\n\n');

  const cost_usd = tokens.prompt_tokens && tokens.completion_tokens
    ? (tokens.prompt_tokens     / 1000) * PRICE_PER_1K_PROMPT +
      (tokens.completion_tokens / 1000) * PRICE_PER_1K_COMPLETION
    : null;

  return { response, model: MODEL, tokens, cost_usd, citations: [] };
}

async function healthCheck() {
  if (!fs.existsSync(CODEX_BIN)) {
    return { ok: false, model: MODEL, last_error: `codex binary not found at ${CODEX_BIN}` };
  }
  const hasAuthFile = fs.existsSync(`${CODEX_HOME}/auth.json`);
  if (!process.env.OPENAI_API_KEY && !hasAuthFile) {
    return { ok: false, model: MODEL, last_error: `no OPENAI_API_KEY and no ${CODEX_HOME}/auth.json (run \`codex login\`)` };
  }
  try {
    fs.accessSync(CODEX_HOME, fs.constants.R_OK);
  } catch {
    return { ok: false, model: MODEL, last_error: `codex home unreadable: ${CODEX_HOME}` };
  }
  // Cheap version-only check; never makes a paid API call.
  const v = await spawnCli({ cmd: CODEX_BIN, args: ['--version'], timeout_ms: 5_000 });
  if (v.code !== 0) {
    return { ok: false, model: MODEL, last_error: `codex --version exit ${v.code}: ${v.stderr.slice(0, 200)}` };
  }
  return { ok: true, model: MODEL, last_error: null, version: v.stdout.trim() };
}

async function estimateCost({ question_size, expected_response_size }) {
  return {
    estimated_tokens: { prompt: question_size, completion: expected_response_size },
    estimated_usd:
      (question_size           / 1000) * PRICE_PER_1K_PROMPT +
      (expected_response_size  / 1000) * PRICE_PER_1K_COMPLETION,
  };
}

const consultant = new BaseConsultant({
  name:        'codex',
  description: 'OpenAI Codex (Rust CLI) — second-opinion code reasoning, refactors, test generation',
  model:       MODEL,
  callConsult,
  healthCheck,
  estimateCost,
});

consultant.start().catch((err) => {
  process.stderr.write(`[consultant-codex] failed to start: ${err.message}\n`);
  process.exit(1);
});
