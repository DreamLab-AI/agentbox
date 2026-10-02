'use strict';

/**
 * spend-policy on the sidestr rail (ADR-2097, amended 2026-10-02).
 *
 * The hook reads [payments.sidestr] (max_sats_per_payment, max_sats_per_day,
 * approval_threshold_sats, falling back to [payments.consumer]'s threshold),
 * keys the daily budget by payer DID, and never consults [payments.consumer]
 * .enabled: the consumer rail stays off while this one is on.
 */

const { spendPolicy } = require('../../../management-api/middleware/spend-policy');

function reply() {
  const r = { statusCode: null, body: null };
  r.code = (c) => { r.statusCode = c; return r; };
  r.send = (b) => { r.body = b; return r; };
  return r;
}

function manifest(sidestr, consumer = { enabled: false, max_sats_per_call: 100, approval_threshold_sats: 50 }) {
  return { payments: { consumer, sidestr } };
}

const RAIL = { enabled: true, chain_id: 'sidestr:dreamlab', max_sats_per_payment: 2000, max_sats_per_day: 3000, approval_threshold_sats: 1500 };

function hookFor(m, ledger = new Map()) {
  return spendPolicy(m, {
    rail: 'sidestr',
    keyOf: (req) => req.payerDid,
    spentToday: (k) => ledger.get(k) || 0,
    reserve: (k, sats) => ledger.set(k, (ledger.get(k) || 0) + sats),
  });
}

async function run(hook, cost, payerDid = 'did:nostr:' + 'a'.repeat(64)) {
  const req = { headers: {}, paymentContext: { cost_sats: cost }, payerDid };
  const rep = reply();
  await hook(req, rep);
  return { req, rep };
}

describe('spend-policy :: sidestr rail', () => {
  it('passes a payment within caps with the consumer rail disabled', async () => {
    const { req, rep } = await run(hookFor(manifest(RAIL)), 1000);
    expect(rep.statusCode).toBeNull();
    expect(req.spendApproved).toBe(true);
    expect(req.requiresApproval).toBeUndefined();
  });

  it('refuses when [payments.sidestr] is disabled', async () => {
    const { rep } = await run(hookFor(manifest({ ...RAIL, enabled: false })), 10);
    expect(rep.statusCode).toBe(402);
    expect(rep.body).toEqual({ error: 'sidestr-rail-disabled' });
  });

  it('refuses when [payments.sidestr] is absent', async () => {
    const { rep } = await run(hookFor({ payments: { consumer: { enabled: true, max_sats_per_call: 100 } } }), 10);
    expect(rep.body).toEqual({ error: 'sidestr-rail-disabled' });
  });

  it('refuses over max_sats_per_payment', async () => {
    const { rep } = await run(hookFor(manifest(RAIL)), 2001);
    expect(rep.statusCode).toBe(402);
    expect(rep.body).toEqual({ error: 'exceeds-per-call-cap' });
  });

  it('refuses a policy without max_sats_per_payment', async () => {
    const { rep } = await run(hookFor(manifest({ enabled: true, chain_id: 'sidestr:dreamlab' })), 1);
    expect(rep.body).toEqual({ error: 'policy-invalid' });
  });

  it('keys max_sats_per_day by payer and reserves what it passes', async () => {
    const ledger = new Map();
    const hook = hookFor(manifest(RAIL), ledger);
    const a = 'did:nostr:' + 'a'.repeat(64);
    const b = 'did:nostr:' + 'b'.repeat(64);
    expect((await run(hook, 1400, a)).rep.statusCode).toBeNull();
    expect((await run(hook, 1400, a)).rep.statusCode).toBeNull();
    const third = await run(hook, 1400, a);
    expect(third.rep.body).toEqual({ error: 'daily-budget-exceeded' });
    expect(ledger.get(a)).toBe(2800);
    expect((await run(hook, 1400, b)).rep.statusCode).toBeNull();
  });

  it('parks a payment above approval_threshold_sats', async () => {
    const { req, rep } = await run(hookFor(manifest(RAIL)), 1600);
    expect(rep.statusCode).toBeNull();
    expect(req.requiresApproval).toBe(true);
  });

  it('falls back to [payments.consumer].approval_threshold_sats', async () => {
    const rail = { ...RAIL };
    delete rail.approval_threshold_sats;
    const { req } = await run(hookFor(manifest(rail)), 51);
    expect(req.requiresApproval).toBe(true);
  });

  it('leaves the consumer rail unchanged: consumer disabled still refuses there', async () => {
    const hook = spendPolicy(manifest(RAIL));
    const rep = reply();
    await hook({ headers: {}, paymentContext: { cost_sats: 1 } }, rep);
    expect(rep.body).toEqual({ error: 'consumer-payments-disabled' });
  });
});
