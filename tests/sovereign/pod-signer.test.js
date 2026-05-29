'use strict';

/**
 * WS4 (PRD-014 Seam C / C2): the pod-signer factory decides — from the
 * manifest gate plus the resolved stack — whether the pods adapter goes out
 * signed. It fails OPEN: any reason it cannot produce a signer (gate off,
 * no stack, key load throws) yields `null`, so the adapter stays unsigned
 * and byte-identical to prior behaviour. Enabling the flag is the only
 * behavioural change.
 */

const { buildPodNip98 } = require('../../management-api/lib/pod-signer');

function manifest(solid = {}) {
  return { integrations: { solid_pod_rs: solid } };
}

describe('buildPodNip98 gating', () => {
  it('returns null when sign_requests is off (default)', () => {
    expect(buildPodNip98(manifest({}))).toBeNull();
    expect(buildPodNip98(manifest({ sign_requests: false }))).toBeNull();
    expect(buildPodNip98({})).toBeNull();
    expect(buildPodNip98(undefined)).toBeNull();
  });

  it('returns null and reports when on but no stack resolves', () => {
    const errors = [];
    const fn = buildPodNip98(manifest({ sign_requests: true }), {
      env: {},
      onError: (e) => errors.push(e),
    });
    expect(fn).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/no stack resolved/);
  });

  it('resolves the stack from env, manifest, in precedence order', () => {
    const seen = [];
    const loadSigner = (stack) => {
      seen.push(stack);
      return { async sign(u) { return { ...u, sig: 's' }; } };
    };
    // AGENTBOX_STACK wins over PROFILE and sign_stack
    buildPodNip98(manifest({ sign_requests: true, sign_stack: 'cfg' }), {
      env: { AGENTBOX_STACK: 'envstack', AGENTBOX_PROFILE: 'prof' },
      loadSigner,
      buildNip98Header: async () => 'Nostr x',
    })('GET', 'http://h/x');
    // falls back to sign_stack when env is empty
    buildPodNip98(manifest({ sign_requests: true, sign_stack: 'cfg' }), {
      env: {},
      loadSigner,
      buildNip98Header: async () => 'Nostr x',
    })('GET', 'http://h/x');
    expect(seen).toEqual(['envstack', 'cfg']);
  });

  it('happy path: returns a fn that signs via the injected header builder', async () => {
    const calls = [];
    const fn = buildPodNip98(manifest({ sign_requests: true, sign_stack: 'main' }), {
      env: {},
      loadSigner: () => ({ async sign(u) { return u; } }),
      buildNip98Header: async (signer, method, url, opts) => {
        calls.push({ method, url, body: opts.body });
        return `Nostr signed`;
      },
    });
    expect(typeof fn).toBe('function');
    const header = await fn('PUT', 'http://h/kg/x', '<a> <b> <c> .');
    expect(header).toBe('Nostr signed');
    expect(calls).toEqual([{ method: 'PUT', url: 'http://h/kg/x', body: '<a> <b> <c> .' }]);
  });

  it('caches the signer across calls (loadSigner invoked once)', async () => {
    let loads = 0;
    const fn = buildPodNip98(manifest({ sign_requests: true, sign_stack: 'main' }), {
      env: {},
      loadSigner: () => { loads += 1; return { async sign(u) { return u; } }; },
      buildNip98Header: async () => 'Nostr x',
    });
    await fn('GET', 'http://h/a');
    await fn('GET', 'http://h/b');
    expect(loads).toBe(1);
  });

  it('fails open: a key-load error yields null headers, not a throw', async () => {
    const errors = [];
    const fn = buildPodNip98(manifest({ sign_requests: true, sign_stack: 'main' }), {
      env: {},
      loadSigner: () => { throw new Error('nsec decrypt failed'); },
      buildNip98Header: async () => 'Nostr x',
      onError: (e) => errors.push(e),
    });
    // factory still returns a function; the per-request header is null
    expect(typeof fn).toBe('function');
    expect(await fn('GET', 'http://h/x')).toBeNull();
    // a second call does not retry the failed load
    expect(await fn('GET', 'http://h/y')).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/nsec decrypt failed/);
  });
});
