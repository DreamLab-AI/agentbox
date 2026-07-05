'use strict';

/**
 * Unit test for config/hooks/lib/trajectory-util.cjs — the honesty-critical grader
 * for the PRD-018 learning loop. Locks the invariant that produced the 0-rows bug:
 * an outcome is graded from a REAL transcript signal (is_error) or NOTHING is
 * written — never defaulted to success (the refuted feedback(true)).
 *
 * gradeResult is the transcript-driven grader (the redesign): the recorder no longer
 * grades per-PostToolUse (which never sees a failed Bash command on this Claude Code
 * build) — it reads tool_result.is_error from the session transcript at Stop.
 */

const util = require('../../config/hooks/lib/trajectory-util.cjs');

describe('trajectory-util.gradeResult (transcript is_error → graded outcome)', () => {
  test('is_error === false + clean stderr → success, quality 1.0', () => {
    const o = util.gradeResult(false, '', false);
    expect(o).toEqual({ success: true, quality: 1.0, signal: 'transcript-is_error' });
  });

  test('is_error === false + noisy stderr → success, quality 0.85 (graded, not binary)', () => {
    const o = util.gradeResult(false, 'warning: something', false);
    expect(o.success).toBe(true);
    expect(o.quality).toBe(0.85);
  });

  test('is_error === true → failure, quality 0.0', () => {
    const o = util.gradeResult(true, 'ls: cannot access', false);
    expect(o).toEqual({ success: false, quality: 0.0, signal: 'transcript-is_error' });
  });

  test('interrupted (user abort) → null (not a command-quality signal)', () => {
    expect(util.gradeResult(false, '', true)).toBeNull();
    expect(util.gradeResult(true, 'x', true)).toBeNull();
  });

  test('is_error absent/undefined → null (undetermined → write NOTHING, I04)', () => {
    expect(util.gradeResult(undefined, '', false)).toBeNull();
    expect(util.gradeResult(null, '', false)).toBeNull();
  });
});

describe('trajectory-util supporting purity (unchanged contracts)', () => {
  test('commandPattern yields a low-cardinality action, never a raw arg', () => {
    const p = util.commandPattern('git commit -m "secret message"');
    expect(typeof p).toBe('string');
    expect(p).toMatch(/^git/);
    expect(p).not.toContain('secret message');
  });

  test('redact returns a string (fail-closed → null only on throw)', () => {
    expect(typeof util.redact('echo hello')).toBe('string');
  });

  test('deriveOutcome (legacy live-tool_response path) still returns null when undetermined', () => {
    // The success shape this Claude Code build emits carries no exit/error field.
    expect(util.deriveOutcome({ stdout: 'ok', stderr: '', interrupted: false })).toBeNull();
  });
});
