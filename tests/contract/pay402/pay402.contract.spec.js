'use strict';

/**
 * Contract test suite — pay402 scheme classifier
 *
 * Verifies the SCHEME GRAMMAR (ADR-032 D2) for classify() across all fixture
 * scenarios and edge cases. Uses the same Jest runner as the rest of the
 * management-api contract suites.
 *
 * Scheme precedence (top-to-bottom, first match wins):
 *   1. agentbox-ledger (status 402 only)
 *   2. x402           (status 402, integer x402Version + accepts[])
 *   3. l402           (status 402 or 401, WWW-Authenticate L402/LSAT)
 *   4. unknown        (terminal, fail-closed)
 */

const path = require('path');
const { classify, buildAcceptsEntry } = require('../../../management-api/lib/pay402');

// ---------------------------------------------------------------------------
// Fixture loader
// ---------------------------------------------------------------------------

function fixture(name) {
  return require(path.join(__dirname, 'fixtures', `${name}.json`));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function callClassify(f) {
  return classify({ status: f.status, headers: f.headers, body: f.body });
}

// ---------------------------------------------------------------------------
// agentbox-ledger
// ---------------------------------------------------------------------------

describe('pay402 :: classify :: agentbox-ledger', () => {
  it('legacy form (X-Pay-Currency header + deposit_endpoint body) → agentbox-ledger', () => {
    const result = callClassify(fixture('agentbox-ledger-legacy'));
    expect(result.scheme).toBe('agentbox-ledger');
    expect(result.offer).not.toBeNull();
    expect(typeof result.offer.amount === 'number' || result.offer.amount === null).toBe(true);
    expect(result.reason).toBeNull();
  });

  it('enriched form (accepts[] entry) → agentbox-ledger', () => {
    const result = callClassify(fixture('agentbox-ledger-enriched'));
    expect(result.scheme).toBe('agentbox-ledger');
    expect(result.offer).not.toBeNull();
    expect(result.reason).toBeNull();
  });

  it('b2-legacy-bytes (exact payment-gate body, no accepts[]) → agentbox-ledger', () => {
    const result = callClassify(fixture('b2-legacy-bytes'));
    expect(result.scheme).toBe('agentbox-ledger');
    expect(result.offer.amount).toBe(100);
    expect(result.reason).toBeNull();
  });

  it('amount mismatch between body.cost_sats and accepts[].amount → unknown(amount-mismatch)', () => {
    const result = callClassify(fixture('agentbox-ledger-mismatch'));
    expect(result.scheme).toBe('unknown');
    expect(result.payable).toBe(false);
    expect(result.reason).toBe('amount-mismatch');
  });

  it('payable is false when CONSUMER_ENABLED is unset', () => {
    const saved = process.env.CONSUMER_ENABLED;
    delete process.env.CONSUMER_ENABLED;
    const result = callClassify(fixture('agentbox-ledger-legacy'));
    expect(result.scheme).toBe('agentbox-ledger');
    expect(result.payable).toBe(false);
    if (saved !== undefined) process.env.CONSUMER_ENABLED = saved;
  });

  it('payable is true when CONSUMER_ENABLED==="true"', () => {
    const saved = process.env.CONSUMER_ENABLED;
    process.env.CONSUMER_ENABLED = 'true';
    const result = callClassify(fixture('agentbox-ledger-legacy'));
    expect(result.scheme).toBe('agentbox-ledger');
    expect(result.payable).toBe(true);
    process.env.CONSUMER_ENABLED = saved !== undefined ? saved : '';
  });
});

// ---------------------------------------------------------------------------
// x402
// ---------------------------------------------------------------------------

describe('pay402 :: classify :: x402', () => {
  it('x402Version:1 with valid accepts[] → x402', () => {
    const result = callClassify(fixture('x402-v1'));
    expect(result.scheme).toBe('x402');
    expect(result.payable).toBe(false);
    expect(result.reason).toBeNull();
    expect(result.offer).not.toBeNull();
    expect(result.offer.x402Version).toBe(1);
  });

  it('x402Version:2 → x402 with unsupported-version', () => {
    const result = callClassify(fixture('x402-v2'));
    expect(result.scheme).toBe('x402');
    expect(result.payable).toBe(false);
    expect(result.reason).toBe('unsupported-version');
  });

  it('adversarial: x402 body with hostile scheme string in accepts → x402 (not agentbox-ledger)', () => {
    // The hostile accepts[0].scheme does NOT equal "agentbox-ledger" (it has SQL injection appended),
    // so agentbox-ledger detection must not fire. The body has x402Version:1 so x402 fires instead.
    const result = callClassify(fixture('adversarial-hostile'));
    expect(result.scheme).toBe('x402');
    expect(result.payable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// l402
// ---------------------------------------------------------------------------

describe('pay402 :: classify :: l402', () => {
  it('L402 auth-scheme with macaroon + lnbc invoice → l402', () => {
    const result = callClassify(fixture('l402-standard'));
    expect(result.scheme).toBe('l402');
    expect(result.payable).toBe(false);
    expect(result.offer).toMatchObject({
      macaroon: expect.any(String),
      invoice: expect.stringMatching(/^lnbc/i),
    });
    expect(result.reason).toBeNull();
  });

  it('LSAT spelling → l402 (case-insensitive)', () => {
    const result = callClassify(fixture('l402-lsat'));
    expect(result.scheme).toBe('l402');
    expect(result.payable).toBe(false);
    expect(result.offer.invoice).toMatch(/^lnbc/i);
    expect(result.reason).toBeNull();
  });

  it('status 401 + L402 header + lntb invoice → l402', () => {
    const result = callClassify(fixture('l402-status-401'));
    expect(result.scheme).toBe('l402');
    expect(result.payable).toBe(false);
    expect(result.offer.invoice).toMatch(/^lntb/i);
    expect(result.reason).toBeNull();
  });

  it('L402 with bad invoice prefix (lnX) → unknown(l402-malformed)', () => {
    const result = callClassify(fixture('l402-bad-invoice'));
    expect(result.scheme).toBe('unknown');
    expect(result.payable).toBe(false);
    expect(result.reason).toBe('l402-malformed');
  });
});

// ---------------------------------------------------------------------------
// unknown
// ---------------------------------------------------------------------------

describe('pay402 :: classify :: unknown', () => {
  it('plain 402 with empty headers and null body → unknown', () => {
    const result = callClassify(fixture('unknown-plain'));
    expect(result.scheme).toBe('unknown');
    expect(result.payable).toBe(false);
    expect(result.offer).toBeNull();
  });

  it('status 200 → unknown (not a payment response)', () => {
    const result = classify({ status: 200, headers: {}, body: null });
    expect(result.scheme).toBe('unknown');
    expect(result.payable).toBe(false);
  });

  it('null body → unknown without throwing', () => {
    expect(() => classify({ status: 402, headers: {}, body: null })).not.toThrow();
    const result = classify({ status: 402, headers: {}, body: null });
    expect(result.scheme).toBe('unknown');
  });

  it('undefined input → unknown without throwing', () => {
    expect(() => classify()).not.toThrow();
    const result = classify();
    expect(result.scheme).toBe('unknown');
  });

  it('65 KiB body (over 64 KiB cap) → unknown(body-too-large)', () => {
    // Build a string that exceeds 64 KiB when UTF-8 encoded.
    const largeBody = 'x'.repeat(65 * 1024);
    const result = classify({ status: 402, headers: {}, body: largeBody });
    expect(result.scheme).toBe('unknown');
    expect(result.reason).toBe('body-too-large');
  });

  it('65 KiB Buffer body → unknown(body-too-large)', () => {
    const largeBuffer = Buffer.alloc(65 * 1024, 0x41);
    const result = classify({ status: 402, headers: {}, body: largeBuffer });
    expect(result.scheme).toBe('unknown');
    expect(result.reason).toBe('body-too-large');
  });

  it('status 403 → unknown (not a recognised payment status)', () => {
    const result = classify({ status: 403, headers: {}, body: null });
    expect(result.scheme).toBe('unknown');
    expect(result.payable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildAcceptsEntry
// ---------------------------------------------------------------------------

describe('pay402 :: buildAcceptsEntry', () => {
  it('returns canonical shape with all required fields', () => {
    const entry = buildAcceptsEntry({
      costSats: 100,
      operatorDid: 'did:web:operator.example',
    });
    expect(entry).toEqual({
      scheme: 'agentbox-ledger',
      currency: 'sats',
      amount: 100,
      pay_to: 'did:web:operator.example',
      ledger: 'web-ledger',
      deposit: '/v1/pay/deposit',
      info: '/v1/pay/info',
    });
  });

  it('overrides deposit and info paths when provided', () => {
    const entry = buildAcceptsEntry({
      costSats: 50,
      operatorDid: 'did:web:other.example',
      depositPath: '/custom/deposit',
      infoPath: '/custom/info',
    });
    expect(entry.deposit).toBe('/custom/deposit');
    expect(entry.info).toBe('/custom/info');
  });

  it('scheme is always "agentbox-ledger"', () => {
    const entry = buildAcceptsEntry({ costSats: 1, operatorDid: 'did:example:1' });
    expect(entry.scheme).toBe('agentbox-ledger');
  });

  it('ledger is always "web-ledger"', () => {
    const entry = buildAcceptsEntry({ costSats: 1, operatorDid: 'did:example:1' });
    expect(entry.ledger).toBe('web-ledger');
  });

  it('currency is always "sats"', () => {
    const entry = buildAcceptsEntry({ costSats: 1, operatorDid: 'did:example:1' });
    expect(entry.currency).toBe('sats');
  });
});

// ---------------------------------------------------------------------------
// Header case-insensitivity (RFC 9110)
// ---------------------------------------------------------------------------

describe('pay402 :: classify :: header case-insensitivity', () => {
  it('x-pay-currency in lowercase is recognised', () => {
    const result = classify({
      status: 402,
      headers: { 'x-pay-currency': 'sats' },
      body: { cost_sats: 100, deposit_endpoint: '/v1/pay/deposit' },
    });
    expect(result.scheme).toBe('agentbox-ledger');
  });

  it('X-PAY-CURRENCY in uppercase is recognised', () => {
    const result = classify({
      status: 402,
      headers: { 'X-PAY-CURRENCY': 'sats' },
      body: { cost_sats: 100, deposit_endpoint: '/v1/pay/deposit' },
    });
    expect(result.scheme).toBe('agentbox-ledger');
  });

  it('www-authenticate in lowercase is recognised for l402', () => {
    const result = classify({
      status: 402,
      headers: { 'www-authenticate': 'L402 macaroon="abc", invoice="lnbc1pvjluezpp5"' },
      body: null,
    });
    expect(result.scheme).toBe('l402');
  });
});
