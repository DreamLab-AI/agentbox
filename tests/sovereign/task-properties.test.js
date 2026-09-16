'use strict';

/**
 * task-properties — ADR-2011 / PRD-augmentation-conditions FR3.4, EXP-AC-003.
 *
 * The boundary between agent and human is set by three OPERATOR-declared
 * properties of the task, not by the requesting agent's self-declared tier.
 * agentbox owns one seed of that triple: `authority_class` already encodes
 * reversibility (`zero-tolerance` = irreversible, `recoverable` = compensable).
 * These tests pin the derivation, the manifest surface for the other two axes,
 * and the invariant that an agent-supplied triple may only TIGHTEN.
 */

const tp = require('../../management-api/lib/task-properties');

const MANIFEST = {
  skills: {
    authority: {
      enabled: true,
      classes: {
        pod_delete: 'zero-tolerance',
        memory_read: 'recoverable',
      },
      task_properties: {
        verifiability: 'partial',
        stakes: 'significant',
        classes: {
          pod_delete: { verifiability: 'opaque', stakes: 'critical' },
          memory_read: { verifiability: 'inspectable', stakes: 'bounded' },
        },
      },
    },
  },
};

describe('task-properties vocabulary', () => {
  test('the three axes carry exactly the ADR-2011 values, loosest first', () => {
    expect(tp.VERIFIABILITY).toEqual(['inspectable', 'partial', 'opaque']);
    expect(tp.REVERSIBILITY).toEqual(['reversible', 'compensable', 'irreversible']);
    expect(tp.STAKES).toEqual(['bounded', 'significant', 'critical']);
  });

  test('tag names are the wire contract the forum reads', () => {
    expect(tp.TAG_NAMES).toEqual({
      verifiability: 'tp-verifiability',
      reversibility: 'tp-reversibility',
      stakes: 'tp-stakes',
    });
  });
});

describe('task-properties.reversibilityFor (the authority_class seed)', () => {
  test('ADR-2011: zero-tolerance ⇒ irreversible', () => {
    expect(tp.reversibilityFor('zero-tolerance')).toBe('irreversible');
  });
  test('ADR-2011: recoverable ⇒ compensable', () => {
    expect(tp.reversibilityFor('recoverable')).toBe('compensable');
  });
  test('an unclassified (escalation-required) action is treated as irreversible — fail-closed', () => {
    expect(tp.reversibilityFor('escalation-required')).toBe('irreversible');
    expect(tp.reversibilityFor(undefined)).toBe('irreversible');
  });
});

describe('task-properties.derive', () => {
  const table = tp.loadTaskPropertyTable(MANIFEST);

  test('EXP-AC-003: a zero-tolerance action class derives reversibility=irreversible', () => {
    const props = tp.derive('pod_delete', { manifest: MANIFEST });
    expect(props).toEqual({ verifiability: 'opaque', reversibility: 'irreversible', stakes: 'critical' });
  });

  test('a recoverable action class derives compensable with its declared axes', () => {
    expect(tp.derive('memory_read', { manifest: MANIFEST })).toEqual({
      verifiability: 'inspectable', reversibility: 'compensable', stakes: 'bounded',
    });
  });

  test('an action class with no per-class entry falls to the manifest defaults', () => {
    expect(tp.derive('memory_store', { manifest: MANIFEST, authorityClass: 'recoverable' })).toEqual({
      verifiability: 'partial', reversibility: 'compensable', stakes: 'significant',
    });
  });

  test('with no manifest at all the defaults are partial / irreversible / significant (fail-closed)', () => {
    expect(tp.derive('anything')).toEqual({
      verifiability: 'partial', reversibility: 'irreversible', stakes: 'significant',
    });
  });

  test('SKILL.md frontmatter sets verifiability and stakes like authority_class does', () => {
    const props = tp.derive('memory_read', {
      manifest: MANIFEST,
      frontmatter: { task_properties: { verifiability: 'opaque', stakes: 'critical' } },
    });
    expect(props).toEqual({ verifiability: 'opaque', reversibility: 'compensable', stakes: 'critical' });
  });

  test('frontmatter authority_class re-seeds reversibility', () => {
    const props = tp.derive('memory_read', {
      manifest: MANIFEST,
      frontmatter: { authority_class: 'zero-tolerance' },
    });
    expect(props.reversibility).toBe('irreversible');
  });

  test('COUNTER-EXAMPLE: frontmatter may not LOOSEN the derived reversibility', () => {
    const props = tp.derive('pod_delete', {
      manifest: MANIFEST,
      frontmatter: { task_properties: { reversibility: 'reversible' } },
    });
    expect(props.reversibility).toBe('irreversible');
  });

  test('COUNTER-EXAMPLE: an agent-requested triple may only tighten, never loosen', () => {
    const props = tp.derive('pod_delete', {
      manifest: MANIFEST,
      requested: { verifiability: 'inspectable', reversibility: 'reversible', stakes: 'bounded' },
    });
    expect(props).toEqual({ verifiability: 'opaque', reversibility: 'irreversible', stakes: 'critical' });
  });

  test('an agent-requested triple that TIGHTENS is honoured', () => {
    const props = tp.derive('memory_read', {
      manifest: MANIFEST,
      requested: { verifiability: 'opaque', stakes: 'critical' },
    });
    expect(props).toEqual({ verifiability: 'opaque', reversibility: 'compensable', stakes: 'critical' });
  });

  test('a malformed requested value is ignored, not fatal', () => {
    expect(tp.derive('memory_read', { manifest: MANIFEST, requested: { stakes: 'apocalyptic' } }).stakes)
      .toBe('bounded');
    expect(tp.derive('memory_read', { manifest: MANIFEST, requested: 'nonsense' }).stakes).toBe('bounded');
  });

  test('loadTaskPropertyTable drops malformed manifest entries', () => {
    const bad = tp.loadTaskPropertyTable({
      skills: { authority: { task_properties: { verifiability: 'wrong', classes: { a: { stakes: 'nope' } } } } },
    });
    expect(bad.defaults).toEqual({ verifiability: 'partial', stakes: 'significant' });
    expect(bad.classes.a).toEqual({});
    expect(table.classes.pod_delete).toEqual({ verifiability: 'opaque', stakes: 'critical' });
  });
});

describe('task-properties.merge (tightening-only, total over all 27×27)', () => {
  test('PROPERTY: merge(base, other) is never looser than base on any axis', () => {
    const all = [];
    for (const v of tp.VERIFIABILITY) for (const r of tp.REVERSIBILITY) for (const s of tp.STAKES) {
      all.push({ verifiability: v, reversibility: r, stakes: s });
    }
    expect(all).toHaveLength(27);
    for (const base of all) {
      for (const other of all) {
        const merged = tp.merge(base, other);
        expect(tp.rank('verifiability', merged.verifiability))
          .toBeGreaterThanOrEqual(tp.rank('verifiability', base.verifiability));
        expect(tp.rank('reversibility', merged.reversibility))
          .toBeGreaterThanOrEqual(tp.rank('reversibility', base.reversibility));
        expect(tp.rank('stakes', merged.stakes)).toBeGreaterThanOrEqual(tp.rank('stakes', base.stakes));
        // and it is idempotent + commutative on the tightening lattice
        expect(tp.merge(merged, merged)).toEqual(merged);
        expect(tp.merge(other, base)).toEqual(merged);
      }
    }
  });
});

describe('task-properties tags (the 31402 wire form)', () => {
  test('toTags always emits all three tags in a stable order', () => {
    expect(tp.toTags({ verifiability: 'opaque', reversibility: 'irreversible', stakes: 'critical' }))
      .toEqual([
        ['tp-verifiability', 'opaque'],
        ['tp-reversibility', 'irreversible'],
        ['tp-stakes', 'critical'],
      ]);
  });

  test('fromTags round-trips, and returns null for a legacy untagged event', () => {
    const props = { verifiability: 'partial', reversibility: 'compensable', stakes: 'bounded' };
    expect(tp.fromTags(tp.toTags(props))).toEqual(props);
    expect(tp.fromTags([['d', 'case-1']])).toBeNull();
    expect(tp.fromTags([['tp-stakes', 'critical']])).toBeNull(); // partial triple is not a triple
  });

  test('isTaskProperties rejects anything not a complete, valid triple', () => {
    expect(tp.isTaskProperties({ verifiability: 'partial', reversibility: 'compensable', stakes: 'bounded' })).toBe(true);
    expect(tp.isTaskProperties({ verifiability: 'partial', reversibility: 'compensable' })).toBe(false);
    expect(tp.isTaskProperties(null)).toBe(false);
  });
});
