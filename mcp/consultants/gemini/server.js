#!/usr/bin/env node
'use strict';

/**
 * Consultant: gemini (@google/gemini-cli).
 *
 * Spawns gemini-cli (installed via toolchains.gemini_cli; lives on the PATH
 * in the agentbox image). Gemini's strength is its 1M-token context window
 * — most useful when the context_excerpt is large.
 *
 * Auth: GOOGLE_GEMINI_API_KEY (canonical) or GEMINI_API_KEY (legacy
 * upstream var). HOME points at the gemini-user dir so any cached login
 * tokens or prefs are honoured.
 */

const { BaseConsultant } = require('../shared/consultant-base');
const { spawnCli } = require('../shared/spawn-cli');

const GEMINI_BIN = process.env.AGENTBOX_GEMINI_BIN || 'gemini';
const GEMINI_HOME = process.env.AGENTBOX_GEMINI_HOME || '/home/gemini-user';
const MODEL = process.env.AGENTBOX_GEMINI_MODEL || 'gemini-2.5-pro';

// Indicative pricing — refresh on tier change. Free tier exists for
// development; paid tier is what the operator opts into when they enable
// the consultant in production.
const PRICE_PER_1K_PROMPT     = 0.00125;
const PRICE_PER_1K_COMPLETION = 0.0050;

function combinedPrompt(question, context) {
  return context
    ? `<context>\n${context}\n</context>\n\n<question>\n${question}\n</question>`
    : question;
}

async function callConsult({ question, context_excerpt }) {
  const prompt = combinedPrompt(question, context_excerpt);
  const result = await spawnCli({
    cmd: GEMINI_BIN,
    args: ['--model', MODEL, '--prompt', prompt, '--no-input'],
    env: {
      HOME:                   GEMINI_HOME,
      GOOGLE_GEMINI_API_KEY:  process.env.GOOGLE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '',
      GEMINI_API_KEY:         process.env.GEMINI_API_KEY        || process.env.GOOGLE_GEMINI_API_KEY || '',
      AGENTBOX_AGENT_ID:      'consultant-gemini',
    },
    timeout_ms: 180_000,
  });
  if (result.code !== 0) {
    throw new Error(
      `gemini CLI exited ${result.code}` +
      (result.killed ? ' (killed by timeout)' : '') +
      (result.stderr ? `: ${result.stderr.slice(0, 400)}` : '')
    );
  }
  // gemini-cli prints the model response on stdout. Token usage is not
  // currently exposed via the CLI, so we approximate from sizes.
  const response = result.stdout;
  const tokens = {
    prompt:     Math.ceil(prompt.length     / 4),
    completion: Math.ceil(response.length   / 4),
  };
  tokens.total = tokens.prompt + tokens.completion;
  const cost_usd =
    (tokens.prompt     / 1000) * PRICE_PER_1K_PROMPT +
    (tokens.completion / 1000) * PRICE_PER_1K_COMPLETION;

  return { response, model: MODEL, tokens, cost_usd, citations: [] };
}

async function healthCheck() {
  const key = process.env.GOOGLE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
  if (!key) {
    return { ok: false, model: MODEL, last_error: 'GOOGLE_GEMINI_API_KEY (or GEMINI_API_KEY) is not set' };
  }
  const v = await spawnCli({
    cmd: GEMINI_BIN,
    args: ['--version'],
    env: { HOME: GEMINI_HOME, GOOGLE_GEMINI_API_KEY: key, GEMINI_API_KEY: key },
    timeout_ms: 10_000,
  });
  if (v.code !== 0) {
    return { ok: false, model: MODEL, last_error: `gemini --version exit ${v.code}: ${v.stderr.slice(0, 200)}` };
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
  name:        'gemini',
  description: 'Google Gemini (CLI) — 1M-token context window for long-document analysis and codebase-wide reasoning',
  model:       MODEL,
  callConsult,
  healthCheck,
  estimateCost,
});

consultant.start().catch((err) => {
  process.stderr.write(`[consultant-gemini] failed to start: ${err.message}\n`);
  process.exit(1);
});
