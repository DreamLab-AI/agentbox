'use strict';

/**
 * Contract test suite — ADR-058 lifecycle-scoped capability composition.
 *
 * @see ADR-058 §Implementation and verification
 */

const {
  CapabilityScope, ServiceRegistry, DuplicateCapabilityIdentity, CapabilityError, EFFECT_TYPES,
} = require('../../management-api/lib/capability-scope');

let idc = 0;
function effect(over = {}) {
  idc += 1;
  return {
    capabilityId: over.capabilityId || 'cap',
    instanceId: over.instanceId || 'default',
    registrationId: over.registrationId || `reg-${idc}`,
    type: over.type || 'listener',
    dispose: over.dispose || (() => {}),
    origin: over.origin,
    trustClass: over.trustClass,
    meta: over.meta,
  };
}

describe('ADR-058 D2 — registrations are owned, scoped effects', () => {
  test('closing a scope disposes effects in reverse registration order', async () => {
    const scope = new CapabilityScope('global');
    const order = [];
    scope.register(effect({ registrationId: 'a', dispose: () => order.push('a') }));
    scope.register(effect({ registrationId: 'b', dispose: () => order.push('b') }));
    scope.register(effect({ registrationId: 'c', dispose: () => order.push('c') }));
    const report = await scope.close();
    expect(order).toEqual(['c', 'b', 'a']);
    expect(report.disposed).toBe(3);
    expect(report.leaked).toEqual([]);
  });

  test('a direct disposer removes exactly one effect and frees its identity', async () => {
    const scope = new CapabilityScope('global');
    const disposer = scope.register(effect({ capabilityId: 'x', registrationId: 'one' }));
    expect(scope.activeEffectCount()).toBe(1);
    await disposer();
    expect(scope.activeEffectCount()).toBe(0);
    // Identity is free again — re-registering the same identity must not throw.
    expect(() => scope.register(effect({ capabilityId: 'x', registrationId: 'one' }))).not.toThrow();
  });

  test('duplicate identity fails loud anywhere in the tree (D5)', () => {
    const global = new CapabilityScope('global');
    const child = global.createChild('session');
    global.register(effect({ capabilityId: 'dup', instanceId: 'i', registrationId: 'r' }));
    expect(() => child.register(effect({ capabilityId: 'dup', instanceId: 'i', registrationId: 'r' })))
      .toThrow(DuplicateCapabilityIdentity);
  });

  test('a child scope closure cannot dispose a parent effect', async () => {
    const global = new CapabilityScope('global');
    let parentDisposed = false;
    global.register(effect({ registrationId: 'parent', dispose: () => { parentDisposed = true; } }));
    const child = global.createChild('agent-child');
    child.register(effect({ registrationId: 'child', dispose: () => {} }));
    await child.close();
    expect(parentDisposed).toBe(false);
    expect(global.activeEffectCount()).toBe(1); // parent effect still live
  });

  test('closing a parent disposes descendant scopes first', async () => {
    const global = new CapabilityScope('global');
    const seq = [];
    global.register(effect({ registrationId: 'g', dispose: () => seq.push('global') }));
    const child = global.createChild('session');
    child.register(effect({ registrationId: 's', dispose: () => seq.push('child') }));
    await global.close();
    expect(seq).toEqual(['child', 'global']); // child unwinds before its parent
  });

  test('rejects unknown effect type and unknown trust class', () => {
    const scope = new CapabilityScope('global');
    expect(() => scope.register(effect({ type: 'wormhole' }))).toThrow(CapabilityError);
    expect(() => scope.register(effect({ trustClass: 'omnipotent' }))).toThrow(CapabilityError);
  });

  test('supports the ADR-058 D2 first-supported effect types', () => {
    const scope = new CapabilityScope('global');
    for (const type of EFFECT_TYPES) {
      expect(() => scope.register(effect({ registrationId: `t-${type}`, type }))).not.toThrow();
    }
  });
});

describe('ADR-058 D2 — bounded async teardown reports leaks', () => {
  test('a disposer that exceeds the timeout is reported as a leak, others still dispose', async () => {
    const scope = new CapabilityScope('global', { disposeTimeoutMs: 30 });
    let cleaned = false;
    scope.register(effect({ registrationId: 'slow', dispose: () => new Promise(() => {}) })); // never resolves
    scope.register(effect({ registrationId: 'fast', dispose: () => { cleaned = true; } }));
    const report = await scope.close();
    expect(cleaned).toBe(true);
    expect(report.leaked.length).toBe(1);
    expect(report.leaked[0].reason).toMatch(/timeout/);
  });

  test('a throwing disposer is reported as a leak without aborting the close', async () => {
    const scope = new CapabilityScope('global');
    scope.register(effect({ registrationId: 'boom', dispose: () => { throw new Error('kaboom'); } }));
    let ok = false;
    scope.register(effect({ registrationId: 'ok', dispose: () => { ok = true; } }));
    const report = await scope.close();
    expect(ok).toBe(true);
    expect(report.leaked[0].reason).toMatch(/kaboom/);
  });
});

describe('ADR-058 D3 — inspectable effective tree with canonical hash', () => {
  test('effective tree exposes provider bindings, origins and trust classes', () => {
    const global = new CapabilityScope('global');
    global.register(effect({ capabilityId: 'search', registrationId: 'tool', type: 'tool', origin: 'profile', trustClass: 'network' }));
    const child = global.createChild('session');
    child.register(effect({ capabilityId: 'prompt', registrationId: 'ctx', type: 'prompt', origin: 'operator' }));
    const tree = global.effectiveTree();
    expect(tree.effects[0]).toMatchObject({ capability_id: 'search', type: 'tool', origin: 'profile', trust_class: 'network' });
    expect(tree.children[0].effects[0]).toMatchObject({ capability_id: 'prompt', origin: 'operator' });
  });

  test('two identically-composed trees hash equal; a changed trust class diverges', () => {
    const build = (trust) => {
      const s = new CapabilityScope('global');
      s.register(effect({ capabilityId: 'a', registrationId: 'r1', type: 'tool', trustClass: trust }));
      s.register(effect({ capabilityId: 'b', registrationId: 'r2', type: 'listener' }));
      return s;
    };
    expect(build('pure').treeHash()).toBe(build('pure').treeHash());
    expect(build('pure').treeHash()).not.toBe(build('network').treeHash());
  });
});

describe('ADR-058 D4 — transactional provider replacement', () => {
  test('a passing candidate is switched in and the old scope is unwound', async () => {
    const root = new CapabilityScope('global');
    const reg = new ServiceRegistry(root);
    let oldDisposed = false;
    reg.bind('model', (scope) => {
      scope.register(effect({ capabilityId: 'model', registrationId: 'v0', dispose: () => { oldDisposed = true; } }));
      return { name: 'v0' };
    });
    const res = await reg.replace('model', (scope) => {
      scope.register(effect({ capabilityId: 'model', registrationId: 'v1', dispose: () => {} }));
      return { name: 'v1' };
    }, (candidate) => candidate.name === 'v1');
    expect(res.ok).toBe(true);
    expect(reg.get('model').name).toBe('v1');
    expect(oldDisposed).toBe(true);
  });

  test('a failing probe leaves the old provider authoritative and unwinds the candidate', async () => {
    const root = new CapabilityScope('global');
    const reg = new ServiceRegistry(root);
    reg.bind('model', (scope) => {
      scope.register(effect({ capabilityId: 'model', registrationId: 'v0', dispose: () => {} }));
      return { name: 'v0' };
    });
    let candidateDisposed = false;
    const res = await reg.replace('model', (scope) => {
      scope.register(effect({ capabilityId: 'model', registrationId: 'bad', dispose: () => { candidateDisposed = true; } }));
      return { name: 'bad' };
    }, () => false); // probe fails
    expect(res.ok).toBe(false);
    expect(reg.get('model').name).toBe('v0'); // old provider still authoritative
    expect(candidateDisposed).toBe(true);     // candidate fully rolled back
  });
});

describe('ADR-058 — churn: repeated mount/unmount is leak-free', () => {
  test('listener/timer/tool counts return to baseline after many cycles', async () => {
    const global = new CapabilityScope('global');
    const baseline = global.totalEffectCount();
    for (let i = 0; i < 200; i++) {
      const child = global.createChild(`cycle-${i}`);
      child.register(effect({ capabilityId: 'churn', instanceId: String(i), registrationId: 'tool', type: 'tool' }));
      child.register(effect({ capabilityId: 'churn', instanceId: String(i), registrationId: 'timer', type: 'timer' }));
      child.register(effect({ capabilityId: 'churn', instanceId: String(i), registrationId: 'listener', type: 'listener' }));
      const report = await child.close();
      expect(report.leaked).toEqual([]);
    }
    expect(global.totalEffectCount()).toBe(baseline);
    // Identity registry is also empty — no residue that would fail-loud next cycle.
    global.createChild('final').register(effect({ capabilityId: 'churn', instanceId: '0', registrationId: 'tool', type: 'tool' }));
    expect(global.totalEffectCount()).toBe(baseline + 1);
  });
});
