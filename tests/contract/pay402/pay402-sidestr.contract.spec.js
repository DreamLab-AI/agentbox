'use strict';

/**
 * Contract test suite — the `sidestr` scheme (ADR-2097 D3, amended 2026-10-02).
 *
 * `sidestr-dreamlab.json` is captured bytes: the 402 that agent B's payee
 * (lib/sidestr-payee.js) served on 2026-10-02 during the ADR-2097 acceptance
 * run against the live `sidestr:dreamlab` producer. The other `sidestr-*`
 * fixtures are adversarial derivations of it (one field changed each, named
 * in the fixture's `derived_from` / `changed` keys). All are immutable once
 * landed (ADR-032 D4); fixtures.sha256 pins them.
 *
 * Owner decision 2026-10-02, SC2: payments settle as sidechain transactions.
 * The accepts[] entry carries a chain id, the payee's chain address and spend
 * key, an amount in sats and a memo (the payee's receipt URN for the charge).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pay402 = require('../../../management-api/lib/pay402');

const { classify, buildSidestrAcceptsEntry, SIDESTR_CHAINS, assertTestnetOnly } = pay402;

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', `${name}.json`), 'utf8'));
}
function run(f, opts) {
  return classify({ status: f.status, headers: f.headers, body: f.body }, opts);
}

const RAIL_ON = { rails: { sidestr: { enabled: true, chain_id: 'sidestr:dreamlab' } } };

describe('pay402 :: sidestr :: captured fixture', () => {
  const f = fixture('sidestr-dreamlab');

  it('classifies as sidestr with the offer fields', () => {
    const r = run(f);
    expect(r.scheme).toBe('sidestr');
    expect(r.reason).toBeNull();
    expect(r.offer).toMatchObject({
      scheme: 'sidestr',
      chain_id: 'sidestr:dreamlab',
      amount_sats: 1000,
      address: expect.stringMatching(/^drm1p[02-9ac-hj-np-z]+$/),
      pubkey: expect.stringMatching(/^[0-9a-f]{64}$/),
      memo: expect.stringMatching(/^urn:agentbox:receipt:[0-9a-f]{64}:sha256-12-[0-9a-f]{12}$/),
    });
  });

  it('is not payable with no rail configured', () => {
    expect(run(f).payable).toBe(false);
  });

  it('is payable with [payments.sidestr] enabled on the same chain', () => {
    expect(run(f, RAIL_ON).payable).toBe(true);
  });

  it('is not payable when the rail is configured for a different chain', () => {
    const r = run(f, { rails: { sidestr: { enabled: true, chain_id: 'sidestr:other' } } });
    expect(r.scheme).toBe('sidestr');
    expect(r.payable).toBe(false);
    expect(r.reason).toBe('sidestr-chain-not-configured');
  });

  it('does not depend on CONSUMER_ENABLED', () => {
    const saved = process.env.CONSUMER_ENABLED;
    process.env.CONSUMER_ENABLED = 'true';
    try {
      expect(run(f).payable).toBe(false);
      expect(run(f, RAIL_ON).payable).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.CONSUMER_ENABLED; else process.env.CONSUMER_ENABLED = saved;
    }
  });

  it('marks the payee DID unverified when no verifier is supplied', () => {
    const r = run(f, RAIL_ON);
    expect(r.offer.payee_did).toBeNull();
    expect(r.offer.pay_to).toMatch(/^did:nostr:[0-9a-f]{64}$/);
  });

  it('verifies the payee binding with an injected verifier', () => {
    const r = run(f, { ...RAIL_ON, verifyEvent: () => true });
    expect(r.offer.payee_did).toBe(r.offer.pay_to);
  });

  it('refuses an offer whose binding does not verify', () => {
    const r = run(f, { ...RAIL_ON, verifyEvent: () => false });
    expect(r.scheme).toBe('unknown');
    expect(r.payable).toBe(false);
    expect(r.reason).toBe('sidestr-binding-invalid');
  });
});

describe('pay402 :: sidestr :: value-leak guard', () => {
  it('refuses a chain id that is not compiled in', () => {
    const r = run(fixture('sidestr-unknown-chain'), RAIL_ON);
    expect(r).toMatchObject({ scheme: 'unknown', payable: false, offer: null, reason: 'sidestr-chain-refused' });
  });

  it('refuses a mainnet-named chain id even with the rail configured for it', () => {
    const f = fixture('sidestr-mainnet-chain');
    const r = run(f, { rails: { sidestr: { enabled: true, chain_id: f.body.accepts[0].chain_id } } });
    expect(r).toMatchObject({ scheme: 'unknown', payable: false, reason: 'sidestr-chain-refused' });
  });

  it('every compiled chain has a testnet parent', () => {
    expect(() => assertTestnetOnly(SIDESTR_CHAINS)).not.toThrow();
    for (const c of Object.values(SIDESTR_CHAINS)) expect(['tbtc4', 'txbt4']).toContain(c.parent);
  });

  it('every compiled chain matches its sealed chain document in config/sidechain', () => {
    const root = path.join(__dirname, '..', '..', '..', 'config', 'sidechain');
    const sealed = fs.readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(root, d.name, 'chain.json')))
      .map((d) => JSON.parse(fs.readFileSync(path.join(root, d.name, 'chain.json'), 'utf8')));
    for (const [id, c] of Object.entries(SIDESTR_CHAINS)) {
      const doc = sealed.find((d) => d.id === id);
      expect(doc).toBeDefined();
      expect({ parent: doc.parent, genesisHash: doc.genesisHash, addressPrefix: doc.addressPrefix })
        .toEqual({ parent: c.parent, genesisHash: c.genesisHash, addressPrefix: c.addressPrefix });
    }
    expect(Object.keys(SIDESTR_CHAINS).sort()).toEqual(['sidestr:dreamlab', 'sidestr:dreamlab-txbt4']);
  });

  it('a dreamlab offer is not payable with the rail switched to the txbt4 chain', () => {
    const r = run(fixture('sidestr-dreamlab'), { rails: { sidestr: { enabled: true, chain_id: 'sidestr:dreamlab-txbt4' } } });
    expect(r).toMatchObject({ scheme: 'sidestr', payable: false, reason: 'sidestr-chain-not-configured' });
  });

  it('the guard throws on a mainnet parent', () => {
    expect(() => assertTestnetOnly({ 'sidestr:x': { parent: 'btc', genesisHash: 'a'.repeat(64), addressPrefix: 'x' } }))
      .toThrow(/mainnet|testnet/);
  });

  it('the compiled table cannot be mutated at runtime', () => {
    expect(Object.isFrozen(SIDESTR_CHAINS)).toBe(true);
    expect(Object.isFrozen(SIDESTR_CHAINS['sidestr:dreamlab'])).toBe(true);
  });
});

describe('pay402 :: sidestr :: malformed', () => {
  it('an address on another chain prefix → unknown(sidestr-malformed)', () => {
    const r = run(fixture('sidestr-wrong-prefix'), RAIL_ON);
    expect(r).toMatchObject({ scheme: 'unknown', payable: false, reason: 'sidestr-malformed' });
  });

  it('a non-integer amount → unknown(sidestr-malformed)', () => {
    const f = fixture('sidestr-dreamlab');
    f.body.accepts[0].amount_sats = 10.5;
    expect(run(f, RAIL_ON).reason).toBe('sidestr-malformed');
  });

  it('a memo that is not a receipt URN → unknown(sidestr-malformed)', () => {
    const f = fixture('sidestr-dreamlab');
    f.body.accepts[0].memo = 'pay me';
    expect(run(f, RAIL_ON).reason).toBe('sidestr-malformed');
  });

  it('status 200 with a sidestr body → unknown', () => {
    const f = fixture('sidestr-dreamlab');
    expect(classify({ status: 200, headers: f.headers, body: f.body }, RAIL_ON).scheme).toBe('unknown');
  });

  it('an unfixtured scheme string stays unknown', () => {
    const f = fixture('sidestr-dreamlab');
    f.body.accepts[0].scheme = 'sidestr-hitch';
    expect(run(f, RAIL_ON)).toMatchObject({ scheme: 'unknown', payable: false });
  });
});

describe('pay402 :: sidestr :: rail isolation (CONSUMER_ENABLED leak)', () => {
  it('with only [payments.sidestr] on, an agentbox-ledger offer stays payable:false', () => {
    const saved = process.env.CONSUMER_ENABLED;
    delete process.env.CONSUMER_ENABLED;
    try {
      const r = run(fixture('agentbox-ledger-enriched'), RAIL_ON);
      expect(r.scheme).toBe('agentbox-ledger');
      expect(r.payable).toBe(false);
      const both = run(fixture('sidestr-and-ledger'), RAIL_ON);
      expect(both.scheme).toBe('agentbox-ledger');
      expect(both.payable).toBe(false);
    } finally {
      if (saved !== undefined) process.env.CONSUMER_ENABLED = saved;
    }
  });
});

describe('pay402 :: buildSidestrAcceptsEntry', () => {
  it('round-trips through classify', () => {
    const f = fixture('sidestr-dreamlab');
    const src = f.body.accepts[0];
    const entry = buildSidestrAcceptsEntry({
      chainId: src.chain_id, address: src.address, pubkey: src.pubkey,
      amountSats: src.amount_sats, memo: src.memo, payTo: src.pay_to, binding: src.binding,
    });
    expect(entry).toEqual(src);
  });

  it('refuses a chain that is not compiled in', () => {
    expect(() => buildSidestrAcceptsEntry({ chainId: 'sidestr:nope', address: 'x', pubkey: 'a'.repeat(64), amountSats: 1, memo: 'm' }))
      .toThrow(/chain/);
  });
});

describe('pay402 :: fixtures are immutable (ADR-032 D4)', () => {
  it('every fixture matches fixtures.sha256', () => {
    const dir = path.join(__dirname, 'fixtures');
    const pinned = fs.readFileSync(path.join(dir, 'fixtures.sha256'), 'utf8').trim().split('\n')
      .map((l) => l.trim().split(/\s+/)).reduce((m, [h, n]) => { m[n] = h; return m; }, {});
    const present = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort();
    expect(Object.keys(pinned).sort()).toEqual(present);
    for (const n of present) {
      const h = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, n))).digest('hex');
      expect(`${n} ${h}`).toBe(`${n} ${pinned[n]}`);
    }
  });
});
