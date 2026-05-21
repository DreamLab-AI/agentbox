#!/usr/bin/env node
'use strict';

/**
 * Consultant: antigravity (Google Antigravity CLI).
 *
 * Spawns `agy` (installed via toolchains.antigravity_cli; lives on PATH
 * in the agentbox image). Antigravity replaces @google/gemini-cli
 * (sunset 2026-06-18) with a Go-native binary and Pro tier web login.
 *
 * Auth: GOOGLE_API_KEY (canonical) or web-based login via `agy auth login`.
 * HOME points at the antigravity home dir so cached session tokens are honoured.
 */

const { BaseConsultant } = require('../shared/consultant-base');
const { spawnCli } = require('../shared/spawn-cli');

const AGY_BIN = process.env.AGENTBOX_ANTIGRAVITY_BIN || 'agy';
const AGY_HOME = process.env.AGENTBOX_ANTIGRAVITY_HOME || '/home/devuser/.antigravity';
const MODEL = process.env.AGENTBOX_ANTIGRAVITY_MODEL || 'gemini-2.5-pro';

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
    cmd: AGY_BIN,
    args: ['--model', MODEL, '--prompt', prompt, '--no-input'],
    env: {
      HOME:               AGY_HOME,
      GOOGLE_API_KEY:     process.env.GOOGLE_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || '',
      AGENTBOX_AGENT_ID:  'consultant-antigravity',
    },
    timeout_ms: 180_000,
  });
  if (result.code !== 0) {
    throw new Error(
      `agy exited ${result.code}` +
      (result.killed ? ' (killed by timeout)' : '') +
      (result.stderr ? `: ${result.stderr.slice(0, 400)}` : '')
    );
  }
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
  const key = process.env.GOOGLE_API_KEY || process.env.GOOGLE_GEMINI_API_KEY;
  if (!key) {
    return { ok: false, model: MODEL, last_error: 'GOOGLE_API_KEY is not set (or authenticate via agy auth login)' };
  }
  const v = await spawnCli({
    cmd: AGY_BIN,
    args: ['--version'],
    env: { HOME: AGY_HOME, GOOGLE_API_KEY: key },
    timeout_ms: 10_000,
  });
  if (v.code !== 0) {
    return { ok: false, model: MODEL, last_error: `agy --version exit ${v.code}: ${v.stderr.slice(0, 200)}` };
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
  name:        'antigravity',
  description: 'Google Antigravity (agy CLI) — 1M-token context window for long-document analysis and codebase-wide reasoning',
  model:       MODEL,
  callConsult,
  healthCheck,
  estimateCost,
});

consultant.start().catch((err) => {
  process.stderr.write(`[consultant-antigravity] failed to start: ${err.message}\n`);
  process.exit(1);
});
