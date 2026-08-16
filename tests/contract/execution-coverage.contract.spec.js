'use strict';

/**
 * Contract test — the /v1/system `execution` coverage block (ADR-057 D5,
 * ADR-058 D3, ADR-059 D5). Verifies the honesty rule: no live instance ⇒
 * status `declared`; a live snapshot ⇒ status `live` and measured numbers.
 */

const { buildExecutionCoverage } = require('../../management-api/lib/execution-coverage');

describe('execution coverage block', () => {
  test('with no live instances every subsystem reports the declared contract', () => {
    const cov = buildExecutionCoverage();
    expect(cov.journal.status).toBe('declared');
    expect(cov.journal.vocabulary).toContain('assistant.completed');
    expect(cov.journal.harness_coverage).toEqual({}); // never inferred
    expect(cov.capabilities.status).toBe('declared');
    expect(cov.capabilities.effect_types).toContain('tool');
    expect(cov.action_pipeline.status).toBe('declared');
    expect(cov.action_pipeline.stages).toHaveLength(9);
    expect(cov.action_pipeline.approval_required).toEqual(expect.arrayContaining(['mutate', 'spend']));
  });

  test('a live snapshot flips status to live and carries measured numbers', () => {
    const cov = buildExecutionCoverage({
      journal: { mode: 'strict', sessions: { 'urn:x': { last_seq: 4, event_count: 5 } }, harness_coverage: { claude: 'partial' } },
      capability: { tree_hash: 'abc123', active_effects: 7 },
      pipeline: { guards: ['spend-cap'], class_coverage: { mutate: 'complete' } },
    });
    expect(cov.journal.status).toBe('live');
    expect(cov.journal.mode).toBe('strict');
    expect(cov.journal.harness_coverage.claude).toBe('partial');
    expect(cov.capabilities.status).toBe('live');
    expect(cov.capabilities.tree_hash).toBe('abc123');
    expect(cov.action_pipeline.status).toBe('live');
    expect(cov.action_pipeline.class_coverage.mutate).toBe('complete');
  });
});
