#!/usr/bin/env node
'use strict';

/**
 * Consultant: zai (Z.AI / GLM via Anthropic-API-compatible claude-zai).
 *
 * claude-zai is the Z.AI variant of the Claude CLI: same wire, different
 * endpoint + key. We invoke it under the zai-user isolation so the Z.AI
 * credential never leaks into devuser's Claude session.
 *
 * Auth: ZAI_ANTHROPIC_API_KEY (passed through as ANTHROPIC_API_KEY for
 * the wrapper) and ZAI_URL (passed through as ANTHROPIC_BASE_URL).
 */

const { BaseConsultant } = require('../shared/consultant-base');
const { spawnCli } = require('../shared/spawn-cli');

const ZAI_BIN  = process.env.AGENTBOX_ZAI_BIN  || 'claude-zai';
const ZAI_HOME = process.env.AGENTBOX_ZAI_HOME || '/home/zai-user';
const MODEL    = process.env.AGENTBOX_ZAI_MODEL || 'glm-5';

const PRICE_PER_1K_PROMPT     = 0.0006;
const PRICE_PER_1K_COMPLETION = 0.0024;

function combinedPrompt(question, context) {
  return context
    ? `Context the coordinator wants you to consider:\n\n${context}\n\n---\n\n${question}`
    : question;
}

async function callConsult({ question, context_excerpt }) {
  const prompt = combinedPrompt(question, context_excerpt);
  const result = await spawnCli({
    cmd: ZAI_BIN,
    args: ['-p', prompt],
    env: {
      HOME:                   ZAI_HOME,
      ANTHROPIC_BASE_URL:     process.env.ZAI_URL                || 'https://api.z.ai/api/anthropic',
      ANTHROPIC_API_KEY:      process.env.ZAI_ANTHROPIC_API_KEY  || process.env.ZAI_API_KEY || '',
      ZAI_API_KEY:            process.env.ZAI_API_KEY            || '',
      AGENTBOX_AGENT_ID:      'consultant-zai',
    },
    timeout_ms: 180_000,
  });
  if (result.code !== 0) {
    throw new Error(
      `claude-zai exited ${result.code}` +
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
  if (!process.env.ZAI_ANTHROPIC_API_KEY && !process.env.ZAI_API_KEY) {
    return { ok: false, model: MODEL, last_error: 'ZAI_ANTHROPIC_API_KEY (or ZAI_API_KEY) is not set' };
  }
  const v = await spawnCli({
    cmd: ZAI_BIN,
    args: ['--version'],
    env: { HOME: ZAI_HOME },
    timeout_ms: 5_000,
  });
  if (v.code !== 0) {
    return { ok: false, model: MODEL, last_error: `claude-zai --version exit ${v.code}: ${v.stderr.slice(0, 200)}` };
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
  name:        'zai',
  description: 'Z.AI / GLM-5 (Anthropic-compatible via claude-zai) — Chinese-language reasoning, low-cost second opinions',
  model:       MODEL,
  callConsult,
  healthCheck,
  estimateCost,
});

consultant.start().catch((err) => {
  process.stderr.write(`[consultant-zai] failed to start: ${err.message}\n`);
  process.exit(1);
});
