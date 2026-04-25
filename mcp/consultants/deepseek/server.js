#!/usr/bin/env node
'use strict';

/**
 * Consultant: deepseek (DeepSeek HTTPS API).
 *
 * Direct HTTPS to api.deepseek.com (or DEEPSEEK_BASE_URL override).
 * deepseek-reasoner returns the model's chain-of-thought in
 * `message.reasoning_content` separately from `message.content`; we
 * fold the reasoning into the response under a `<reasoning>...</reasoning>`
 * preamble so the coordinator can choose to inspect it.
 *
 * Auth: DEEPSEEK_API_KEY.
 */

const { BaseConsultant } = require('../shared/consultant-base');

const ENDPOINT = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const MODEL    = process.env.AGENTBOX_DEEPSEEK_MODEL || 'deepseek-reasoner';

const PRICE_PER_1K_PROMPT     = 0.00055;
const PRICE_PER_1K_COMPLETION = 0.00219;

async function callConsult({ question, context_excerpt }) {
  const messages = [];
  if (context_excerpt) messages.push({
    role: 'system',
    content: `Context the coordinator wants you to consider:\n\n${context_excerpt}`,
  });
  messages.push({ role: 'user', content: question });

  const res = await fetch(`${ENDPOINT}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY || ''}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`deepseek HTTP ${res.status}${body ? `: ${body.slice(0, 400)}` : ''}`);
  }
  const data = await res.json();
  const choice = (data.choices && data.choices[0]) || {};
  const msg = choice.message || {};
  const usage = data.usage || {};

  const reasoning = msg.reasoning_content || '';
  const answer    = msg.content           || '';
  const response  = reasoning
    ? `<reasoning>\n${reasoning}\n</reasoning>\n\n${answer}`
    : answer;

  const tokens = {
    prompt:     usage.prompt_tokens     || 0,
    completion: usage.completion_tokens || 0,
    total:      usage.total_tokens      || 0,
  };
  const cost_usd =
    (tokens.prompt     / 1000) * PRICE_PER_1K_PROMPT +
    (tokens.completion / 1000) * PRICE_PER_1K_COMPLETION;
  return {
    response,
    model:     data.model || MODEL,
    tokens,
    cost_usd,
    citations: [],
  };
}

async function healthCheck() {
  if (!process.env.DEEPSEEK_API_KEY) {
    return { ok: false, model: MODEL, last_error: 'DEEPSEEK_API_KEY is not set' };
  }
  try {
    const res = await fetch(`${ENDPOINT}/v1/models`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}` },
    });
    if (!res.ok) return { ok: false, model: MODEL, last_error: `HTTP ${res.status}` };
    return { ok: true, model: MODEL, last_error: null };
  } catch (err) {
    return { ok: false, model: MODEL, last_error: err.message };
  }
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
  name:        'deepseek',
  description: 'DeepSeek deepseek-reasoner (HTTPS API) — transparent chain-of-thought, strong on math + code reasoning',
  model:       MODEL,
  callConsult,
  healthCheck,
  estimateCost,
});

consultant.start().catch((err) => {
  process.stderr.write(`[consultant-deepseek] failed to start: ${err.message}\n`);
  process.exit(1);
});
