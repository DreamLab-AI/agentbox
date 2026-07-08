'use strict';

/**
 * Unit test for mcp/consultants/shared/model-diversity.js — the REC-8 anti-fox
 * cross-model verification seam (PRD-019 / ADR-037 D4).
 *
 * Locks the falsification clauses:
 *   1. a producing family X is NEVER verified by a consultant of family X
 *      (exhaustive over every consultant-as-producer and every family token);
 *   2. when no different-family consultant is available the selector returns
 *      null — an honest shortfall, never a same-family fallback;
 *   3. the producing family is recorded against the verification (verificationRecord);
 *   4. the wrapper stays over the ADR-011 named-consultant seam — the base
 *      consultant stamps the anti-fox record on its envelope when a consult
 *      declares the producing family, and flags a same-family self-verification.
 */

const os = require('os');
const path = require('path');
const diversity = require('../../mcp/consultants/shared/model-diversity');

describe('model-diversity.familyOf', () => {
  test('resolves each named consultant to its registered family', () => {
    expect(diversity.familyOf('codex')).toBe('openai');
    expect(diversity.familyOf('antigravity')).toBe('google');
    expect(diversity.familyOf('zai')).toBe('zhipu');
    expect(diversity.familyOf('perplexity')).toBe('perplexity');
    expect(diversity.familyOf('deepseek')).toBe('deepseek');
  });

  test('resolves concrete model ids by prefix (producer side)', () => {
    expect(diversity.familyOf('gpt-5.5')).toBe('openai');
    expect(diversity.familyOf('o3-mini')).toBe('openai');
    expect(diversity.familyOf('gemini-3.5-flash')).toBe('google');
    expect(diversity.familyOf('glm-5.2')).toBe('zhipu');
    expect(diversity.familyOf('sonar-pro')).toBe('perplexity');
    expect(diversity.familyOf('deepseek-reasoner')).toBe('deepseek');
    expect(diversity.familyOf('claude-opus-4-8')).toBe('anthropic');
    expect(diversity.familyOf('opus')).toBe('anthropic');
  });

  test('resolves vendor-prefixed and Bedrock-style ids', () => {
    expect(diversity.familyOf('openai/gpt-5.5')).toBe('openai');
    expect(diversity.familyOf('us.anthropic.claude-opus-4')).toBe('anthropic');
  });

  test('accepts a bare family token as-is', () => {
    expect(diversity.familyOf('anthropic')).toBe('anthropic');
    expect(diversity.familyOf('openai')).toBe('openai');
  });

  test('unrecognisable input resolves to "unknown", never throws', () => {
    expect(diversity.familyOf('totally-made-up-model')).toBe('unknown');
    expect(diversity.familyOf('')).toBe('unknown');
    expect(diversity.familyOf(null)).toBe('unknown');
    expect(diversity.familyOf(undefined)).toBe('unknown');
  });
});

describe('model-diversity.selectVerifier — FALSIFICATION 1: producer family X is never verified by family X', () => {
  test('every consultant-as-producer selects a DIFFERENT-family verifier', () => {
    for (const producer of diversity.CONSULTANT_ORDER) {
      const producerFamily = diversity.FAMILY_BY_CONSULTANT[producer];
      const sel = diversity.selectVerifier({ producerFamily: producer });
      expect(sel).not.toBeNull();
      expect(sel.consultant).not.toBe(producer);
      expect(sel.family).not.toBe(producerFamily);
      expect(diversity.isDiverse(producerFamily, sel.family)).toBe(true);
    }
  });

  test('every known family token as producer selects a different-family verifier', () => {
    const families = ['openai', 'google', 'zhipu', 'perplexity', 'deepseek', 'anthropic', 'xai', 'meta'];
    for (const producerFamily of families) {
      const sel = diversity.selectVerifier({ producerFamily });
      expect(sel).not.toBeNull();
      expect(sel.family).not.toBe(producerFamily);
    }
  });

  test('a producing model id (not just a token) is honoured — codex-produced change is not verified by codex', () => {
    const sel = diversity.selectVerifier({ producerFamily: 'gpt-5.5' });
    expect(sel).not.toBeNull();
    expect(sel.consultant).not.toBe('codex');
    expect(sel.family).not.toBe('openai');
  });

  test('an unknown producer family is diverse from every named consultant (any pick is valid)', () => {
    const sel = diversity.selectVerifier({ producerFamily: 'mystery-model' });
    expect(sel).not.toBeNull();
    expect(sel.producer_family).toBe('unknown');
    // whichever consultant is chosen, its family is a real (non-unknown) family.
    expect(diversity.CONSULTANT_FAMILIES).toContain(sel.family);
  });
});

describe('model-diversity.selectVerifier — FALSIFICATION 2: no same-family fallback', () => {
  test('returns null when the only candidate shares the producer family (honest shortfall)', () => {
    const sel = diversity.selectVerifier({ producerFamily: 'openai', candidates: ['codex'] });
    expect(sel).toBeNull();
  });

  test('returns null when every candidate is excluded down to a same-family one', () => {
    // producer is deepseek; exclude every different-family consultant, leaving
    // only deepseek itself → no diverse verifier available.
    const sel = diversity.selectVerifier({
      producerFamily: 'deepseek',
      exclude: ['codex', 'antigravity', 'zai', 'perplexity'],
    });
    expect(sel).toBeNull();
  });

  test('excluded consultants are never selected', () => {
    const sel = diversity.selectVerifier({ producerFamily: 'anthropic', exclude: ['codex', 'antigravity'] });
    expect(sel).not.toBeNull();
    expect(['codex', 'antigravity']).not.toContain(sel.consultant);
  });
});

describe('model-diversity.selectVerifier — prefer honoured only when diverse', () => {
  test('a preferred different-family consultant is chosen', () => {
    const sel = diversity.selectVerifier({ producerFamily: 'anthropic', prefer: 'deepseek' });
    expect(sel.consultant).toBe('deepseek');
    expect(sel.reason).toMatch(/preferred/);
  });

  test('a preferred SAME-family consultant is rejected in favour of a diverse pick', () => {
    // producer is openai; prefer codex (also openai) — must NOT be honoured.
    const sel = diversity.selectVerifier({ producerFamily: 'openai', prefer: 'codex' });
    expect(sel).not.toBeNull();
    expect(sel.consultant).not.toBe('codex');
    expect(sel.family).not.toBe('openai');
  });
});

describe('model-diversity.verificationRecord — FALSIFICATION 3: producing family recorded, verdict correct', () => {
  test('different families → anti_fox_ok true, both families recorded', () => {
    const rec = diversity.verificationRecord({ producerFamily: 'anthropic', verifier: 'deepseek' });
    expect(rec.producer_family).toBe('anthropic');
    expect(rec.verifier_family).toBe('deepseek');
    expect(rec.anti_fox_ok).toBe(true);
    expect(rec.kind).toBe('anti-fox-verification');
  });

  test('same family → anti_fox_ok false (self-verification flagged, not silent)', () => {
    const rec = diversity.verificationRecord({ producerFamily: 'gpt-5.5', verifier: 'codex' });
    expect(rec.producer_family).toBe('openai');
    expect(rec.verifier_family).toBe('openai');
    expect(rec.anti_fox_ok).toBe(false);
  });
});

// ── FALSIFICATION 4: the wire — the base consultant stamps the anti-fox record ──
let BaseConsultant;
try {
  ({ BaseConsultant } = require('../../mcp/consultants/shared/consultant-base'));
} catch (_e) {
  BaseConsultant = null;
}

(BaseConsultant ? describe : describe.skip)('consultant-base wiring — anti-fox record on the envelope', () => {
  function buildConsultant(name) {
    return new BaseConsultant({
      name,
      description: `test ${name}`,
      model: diversity.FAMILY_BY_CONSULTANT[name] === 'openai' ? 'gpt-5.5' : name,
      log_dir: path.join(os.tmpdir(), 'agentbox-model-diversity-test'),
      // deterministic in-test callConsult — supplies a fixed answer so the
      // envelope path runs without a live model call.
      callConsult: async () => ({ response: 'ok', model: 'test', tokens: {}, cost_usd: 0, citations: [] }),
      healthCheck: async () => ({ ok: true, model: 'test' }),
      estimateCost: async () => ({ estimated_tokens: {}, estimated_usd: 0 }),
    });
  }

  test('a consult declaring a DIFFERENT producer family stamps anti_fox_ok true', async () => {
    const c = buildConsultant('deepseek'); // family deepseek
    const env = await c._handleConsult({ question: 'verify this closure', producer_family: 'anthropic' });
    expect(env.verification).toBeDefined();
    expect(env.verification.producer_family).toBe('anthropic');
    expect(env.verification.verifier_family).toBe('deepseek');
    expect(env.verification.anti_fox_ok).toBe(true);
  });

  test('a consult whose producer family MATCHES this consultant is flagged (anti_fox_ok false)', async () => {
    const c = buildConsultant('codex'); // family openai
    const env = await c._handleConsult({ question: 'verify this closure', producer_family: 'gpt-5.5' });
    expect(env.verification).toBeDefined();
    expect(env.verification.anti_fox_ok).toBe(false);
    expect(env.verification.verifier_family).toBe('openai');
  });

  test('a consult with no producer_family carries no verification (byte-compatible)', async () => {
    const c = buildConsultant('perplexity');
    const env = await c._handleConsult({ question: 'plain consult' });
    expect(env.verification).toBeUndefined();
  });
});
