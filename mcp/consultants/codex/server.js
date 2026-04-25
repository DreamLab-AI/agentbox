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
const MODEL = process.env.AGENTBOX_CODEX_MODEL || 'gpt-5.4';

// Rough USD per 1k tokens — published rate at time of writing; refresh on bump.
const PRICE_PER_1K_PROMPT     = 0.005;
const PRICE_PER_1K_COMPLETION = 0.015;

function formatPrompt(question, context) {
  return context
    ? `# Context (excerpt provided by the coordinator)\n\n${context}\n\n---\n\n# Question\n\n${question}\n`
    : question;
}

async function callConsult({ question, context_excerpt }) {
  const prompt = formatPrompt(question, context_excerpt);
  const result = await spawnCli({
    cmd: CODEX_BIN,
    args: ['exec', '--json', '--', prompt],
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

  // Codex --json emits a JSONL stream; the final {"type":"final","content":"..."}
  // record carries the answer. Fall back to raw stdout if parsing fails.
  let response = result.stdout;
  let tokens = {};
  try {
    const lines = result.stdout.trim().split('\n').filter(Boolean);
    for (const line of lines.reverse()) {
      const obj = JSON.parse(line);
      if (obj.type === 'final' || obj.type === 'message') {
        response = obj.content || obj.message || response;
        if (obj.usage) tokens = obj.usage;
        break;
      }
    }
  } catch {
    // raw stdout already assigned
  }

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
  if (!process.env.OPENAI_API_KEY) {
    return { ok: false, model: MODEL, last_error: 'OPENAI_API_KEY is not set' };
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
