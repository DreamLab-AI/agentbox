'use strict';

/**
 * Unit test for management-api/lib/failure-taxonomy.js — the single canonical
 * MAST 14-mode taxonomy (REC-5, PRD-019 / ADR-037 D1).
 *
 * Locks the honesty invariant D1 rests on: a failure maps to a mode ONLY where
 * the signal genuinely resolves one; everything else is the `unmapped` sentinel,
 * never a fabricated mode and never a dropped failure.
 */

const tax = require('../../management-api/lib/failure-taxonomy');

describe('failure-taxonomy — the 14 MAST modes defined once', () => {
  test('exactly 14 modes across 3 categories, ids FM-x.y', () => {
    expect(tax.MODES).toHaveLength(14);
    expect(tax.MODE_IDS).toHaveLength(14);
    expect(Object.keys(tax.CATEGORIES)).toHaveLength(3);
    for (const m of tax.MODES) {
      expect(m.id).toMatch(/^FM-[123]\.[1-6]$/);
      expect(typeof m.name).toBe('string');
      expect(tax.CATEGORIES[m.category]).toBeDefined();
    }
  });

  test('the canonical id set is exactly the paper\'s three-category structure', () => {
    expect([...tax.MODE_IDS].sort()).toEqual([
      'FM-1.1', 'FM-1.2', 'FM-1.3', 'FM-1.4', 'FM-1.5',
      'FM-2.1', 'FM-2.2', 'FM-2.3', 'FM-2.4', 'FM-2.5', 'FM-2.6',
      'FM-3.1', 'FM-3.2', 'FM-3.3',
    ]);
  });

  test('isMode vs isTag: unmapped is a valid TAG but not a MODE', () => {
    expect(tax.isMode('FM-1.2')).toBe(true);
    expect(tax.isMode('unmapped')).toBe(false);
    expect(tax.isMode('FM-9.9')).toBe(false);
    expect(tax.isTag('unmapped')).toBe(true);
    expect(tax.isTag('FM-1.2')).toBe(true);
    expect(tax.isTag('nonsense')).toBe(false);
    expect(tax.UNMAPPED).toBe('unmapped');
  });
});

describe('failure-taxonomy.classify — maps only on real signal, else unmapped', () => {
  test('an explicit valid mode id passes through', () => {
    expect(tax.classify({ mode: 'FM-3.1' })).toBe('FM-3.1');
  });

  test('a symbolic reason maps to its mode (IDENTITY_MISMATCH → FM-1.2)', () => {
    expect(tax.classify({ reason: tax.REASON.IDENTITY_MISMATCH })).toBe('FM-1.2');
    expect(tax.classify({ reason: tax.REASON.PREMATURE_TERMINATION })).toBe('FM-3.1');
    expect(tax.classify({ reason: tax.REASON.CONTEXT_LOSS })).toBe('FM-1.4');
  });

  test('high-precision stderr heuristics fire (permission → FM-1.2, context → FM-1.4)', () => {
    expect(tax.classify({ stderr: 'bash: /etc/shadow: Permission denied' })).toBe('FM-1.2');
    expect(tax.classify({ stderr: 'Error: maximum context length exceeded (8192 tokens)' })).toBe('FM-1.4');
  });

  test('a generic non-zero-exit failure with no resolving signal → unmapped (NOT fabricated)', () => {
    expect(tax.classify({ signal: 'transcript-is_error', action: 'git commit [args:0 flags:1]' }))
      .toBe('unmapped');
    expect(tax.classify({ stderr: 'fatal: some opaque tool error' })).toBe('unmapped');
    expect(tax.classify({})).toBe('unmapped');
    expect(tax.classify()).toBe('unmapped');
  });

  test('an unknown reason string does not fabricate a mode → unmapped', () => {
    expect(tax.classify({ reason: 'NOT_A_REAL_REASON' })).toBe('unmapped');
  });

  test('an invalid mode id does not pass through → falls to reason/heuristic/unmapped', () => {
    expect(tax.classify({ mode: 'FM-42' })).toBe('unmapped');
  });
});

describe('failure-taxonomy.tagFailure — always a tag, human text kept as detail', () => {
  test('a mapped failure keeps the mode and preserves the detail text', () => {
    const t = tax.tagFailure({ reason: tax.REASON.IDENTITY_MISMATCH, error: 'source_urn does not match verified did' });
    expect(t.failure_mode).toBe('FM-1.2');
    expect(t.failure_detail).toBe('source_urn does not match verified did');
  });

  test('an unresolvable failure is tagged unmapped, never dropped', () => {
    const t = tax.tagFailure({ error: 'invalid NIP-98 signature' });
    expect(t.failure_mode).toBe('unmapped');
    expect(t.failure_detail).toBe('invalid NIP-98 signature');
  });

  test('detail is capped and never null-drops when absent', () => {
    const long = 'x'.repeat(5000);
    const t = tax.tagFailure({ stderr: long });
    expect(t.failure_detail.length).toBeLessThanOrEqual(2001);
    expect(tax.tagFailure({}).failure_detail).toBeNull();
    expect(tax.tagFailure({}).failure_mode).toBe('unmapped');
  });
});
