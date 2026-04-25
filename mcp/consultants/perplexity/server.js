#!/usr/bin/env node
'use strict';

/**
 * Consultant: perplexity (Perplexity HTTPS API).
 *
 * Direct HTTPS to api.perplexity.ai. No CLI wrapping needed — the API
 * already returns structured citations alongside the answer, which is
 * exactly the value the consultant tier exposes through the `citations`
 * envelope field.
 *
 * Auth: PERPLEXITY_API_KEY.
 */

const { BaseConsultant } = require('../shared/consultant-base');

const ENDPOINT = process.env.PERPLEXITY_BASE_URL || 'https://api.perplexity.ai';
const MODEL    = process.env.AGENTBOX_PERPLEXITY_MODEL || 'sonar-pro';

// Indicative — sonar-pro pricing as of 2026-04. Free tier exists.
const PRICE_PER_1K_PROMPT     = 0.003;
const PRICE_PER_1K_COMPLETION = 0.015;

async function callConsult({ question, context_excerpt }) {
  const messages = [
    { role: 'system', content: 'You are a research assistant. Cite sources. Be concise; include only sources you actually used.' },
  ];
  if (context_excerpt) messages.push({ role: 'user', content: `Context the coordinator wants you to consider:\n\n${context_excerpt}` });
  messages.push({ role: 'user', content: question });

  const res = await fetch(`${ENDPOINT}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY || ''}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      return_citations: true,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`perplexity HTTP ${res.status}${body ? `: ${body.slice(0, 400)}` : ''}`);
  }
  const data = await res.json();
  const choice = (data.choices && data.choices[0]) || {};
  const usage  = data.usage || {};
  const tokens = {
    prompt:     usage.prompt_tokens     || 0,
    completion: usage.completion_tokens || 0,
    total:      usage.total_tokens      || 0,
  };
  const cost_usd =
    (tokens.prompt     / 1000) * PRICE_PER_1K_PROMPT +
    (tokens.completion / 1000) * PRICE_PER_1K_COMPLETION;
  return {
    response:  (choice.message && choice.message.content) || '',
    model:     data.model || MODEL,
    tokens,
    cost_usd,
    citations: Array.isArray(data.citations) ? data.citations : [],
  };
}

async function healthCheck() {
  if (!process.env.PERPLEXITY_API_KEY) {
    return { ok: false, model: MODEL, last_error: 'PERPLEXITY_API_KEY is not set' };
  }
  // No metadata endpoint; ping with a 1-token throwaway. Counted, but
  // cheap. Health checks should be infrequent.
  try {
    const res = await fetch(`${ENDPOINT}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
    });
    if (!res.ok) {
      return { ok: false, model: MODEL, last_error: `HTTP ${res.status}` };
    }
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
  name:        'perplexity',
  description: 'Perplexity (HTTPS API) — live-web research with citations; pick this when current information matters',
  model:       MODEL,
  callConsult,
  healthCheck,
  estimateCost,
});

consultant.start().catch((err) => {
  process.stderr.write(`[consultant-perplexity] failed to start: ${err.message}\n`);
  process.exit(1);
});
