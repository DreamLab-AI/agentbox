'use strict';

/**
 * ADR-2026 closeout acceptance (2026-09-05) — the content-egress boundary.
 *
 * The estate review established that:
 *   • there was NO redaction stage between body selection and gift-wrapping, so
 *     an invented `password=` sentinel survived into the composed rumor for both
 *     the explicit-recipient and child-key configurations;
 *   • `AGENTBOX_LIVE_MIRROR=0` proved nothing about the separately configured
 *     Rust digest path;
 *   • recipient syntax was checked but no enumerated allowlist existed;
 *   • exit zero could not distinguish disabled from failed from delivered.
 *
 * These tests exercise the ACTUAL hook as a subprocess. The network-denial cases
 * point the relay at an address that cannot be reached, so nothing can leave the
 * machine, and assert the three outcomes are distinguishable.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const HOOK = path.resolve(__dirname, '../../config/hooks/nostr-live-mirror.cjs');
const POLICY = path.resolve(__dirname, '../../config/hooks/lib/egress-policy.cjs');
const POLICY_DOC = path.resolve(__dirname, '../../config/egress-policy.json');
const FIXTURE = path.resolve(__dirname, '../fixtures/egress-redaction.v1.json');

const egress = require(POLICY);

// A 64-hex operator key (invented) so the child-key derivation path is live.
const FAKE_SK = 'a'.repeat(64);
const FAKE_RECIPIENT = 'b'.repeat(64);
// An address nothing can reach: the discard port on loopback.
const DENIED_RELAY = 'ws://127.0.0.1:1';

function runHook(event, env, payload) {
  const base = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_PATH: process.env.NODE_PATH || '',
    // Never let a test inherit a real mirror configuration.
    AGENTBOX_PRIVKEY_HEX: '',
    AGENTBOX_BRIDGE_SK: '',
    OPERATOR_NOSTR_PRIVKEY: '',
    AGENTBOX_MIRROR_RECIPIENT_PUBKEY: '',
    AGENTBOX_PUBKEY: '',
    AGENTBOX_ADMIN_PUBKEY: '',
    AGENTBOX_BRIDGE_RECIPIENT_PUBKEY: '',
    NOSTR_MIRROR_RELAY: DENIED_RELAY,
  };
  const r = spawnSync('node', [HOOK, event], {
    input: JSON.stringify(payload || { session_id: 's1', prompt: 'test' }),
    encoding: 'utf8',
    env: { ...base, ...env },
    timeout: 20000,
  });
  return { status: r.status, stderr: r.stderr || '', stdout: r.stdout || '' };
}

describe('ADR-2026 — the policy document and both implementations agree', () => {
  test('the policy document enumerates content, recipients, providers, encryption and retention per path', () => {
    const doc = JSON.parse(fs.readFileSync(POLICY_DOC, 'utf8'));
    expect(doc.schema).toBe('agentbox/egress-policy@1');
    const ids = doc.paths.map((p) => p.id).sort();
    expect(ids).toEqual(['live-mirror', 'session-digest']);
    for (const p of doc.paths) {
      for (const field of ['content', 'recipients', 'providers', 'encryption', 'transport', 'log_retention']) {
        expect(typeof p[field]).toBe('string');
        expect(p[field].length).toBeGreaterThan(20);
      }
    }
    // The four outcomes are the shared vocabulary both runtimes emit.
    expect(Object.keys(doc.outcomes).sort()).toEqual(['accepted', 'attempted', 'failed', 'skipped']);
    expect(doc.switches.AGENTBOX_EGRESS).toMatch(/global/i);
  });

  test('the JavaScript redactor satisfies the PAIRED cross-language fixture', () => {
    const fx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    expect(fx.cases.length).toBeGreaterThan(5);
    for (const c of fx.cases) {
      expect(egress.redactForEgress(c.input)).toBe(c.expected);
    }
  });

  test('redaction failure is fail-closed (null means do not send)', () => {
    expect(egress.redactForEgress(null)).toBeNull();
    expect(egress.redactForEgress({ a: 1 })).toBeNull();
  });
});

describe('ADR-2026 — the off-switch matrix', () => {
  test('the GLOBAL switch stops the live mirror even with a full identity', () => {
    const r = runHook('UserPromptSubmit', {
      AGENTBOX_EGRESS: '0',
      AGENTBOX_PRIVKEY_HEX: FAKE_SK,
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/egress skipped: egress-globally-disabled/);
    expect(r.stderr).not.toMatch(/attempted|accepted/);
  });

  test('the per-path switch stops it too, with its own reason', () => {
    const r = runHook('UserPromptSubmit', {
      AGENTBOX_LIVE_MIRROR: '0',
      AGENTBOX_PRIVKEY_HEX: FAKE_SK,
    });
    expect(r.stderr).toMatch(/egress skipped: live-mirror-disabled/);
  });

  test('disabling redaction REFUSES the egress rather than sending raw', () => {
    const r = runHook('UserPromptSubmit', {
      AGENTBOX_EGRESS_REDACTION: '0',
      AGENTBOX_PRIVKEY_HEX: FAKE_SK,
    });
    expect(r.stderr).toMatch(/egress skipped: redaction-disabled-so-egress-refused/);
    expect(r.stderr).not.toMatch(/attempted/);
  });

  test('ABSENT identity is a named skip, not a silent success', () => {
    const r = runHook('UserPromptSubmit', {});
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/egress skipped: no-sender-identity/);
  });

  test('CHILD-KEY derivation supplies the identity when no explicit recipient is set', () => {
    const r = runHook('UserPromptSubmit', {
      AGENTBOX_PRIVKEY_HEX: FAKE_SK,
      AGENTBOX_MIRROR_DRY_RUN: '1',
    });
    expect(r.stderr).toMatch(/DRY-RUN/);
    expect(r.stderr).toMatch(/recipient=child-self-dm/);
  });

  test('child derivation can be turned off, falling back to the explicit recipient', () => {
    const r = runHook('UserPromptSubmit', {
      AGENTBOX_PRIVKEY_HEX: FAKE_SK,
      AGENTBOX_MIRROR_CHILD: '0',
      AGENTBOX_MIRROR_RECIPIENT_PUBKEY: FAKE_RECIPIENT,
      AGENTBOX_MIRROR_DRY_RUN: '1',
    });
    expect(r.stderr).toMatch(new RegExp(`recipient=${FAKE_RECIPIENT}`));
  });

  test('a MALFORMED recipient with no derivable child key is refused as absent identity', () => {
    const r = runHook('UserPromptSubmit', {
      AGENTBOX_MIRROR_CHILD: '0',
      AGENTBOX_MIRROR_RECIPIENT_PUBKEY: 'not-a-pubkey',
    });
    expect(r.stderr).toMatch(/egress skipped: no-sender-identity/);
    expect(r.stderr).not.toMatch(/attempted/);
  });
});

describe('ADR-2026 — recipient allowlist (syntax was never sufficient)', () => {
  test('a syntactically valid recipient OUTSIDE the allowlist is refused', () => {
    const decision = egress.egressDecision('live-mirror', {
      env: { AGENTBOX_MIRROR_RECIPIENTS: 'c'.repeat(64) },
      recipient: FAKE_RECIPIENT,
      identityPresent: true,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('recipient-not-allowlisted');
    expect(decision.outcome).toBe('skipped');
  });

  test('a recipient INSIDE the allowlist is permitted', () => {
    const decision = egress.egressDecision('live-mirror', {
      env: { AGENTBOX_MIRROR_RECIPIENTS: `${'c'.repeat(64)},${FAKE_RECIPIENT}` },
      recipient: FAKE_RECIPIENT,
      identityPresent: true,
    });
    expect(decision.allowed).toBe(true);
  });

  test('with NO allowlist configured, a well-formed recipient is permitted (back-compatible)', () => {
    const decision = egress.egressDecision('live-mirror', {
      env: {}, recipient: FAKE_RECIPIENT, identityPresent: true,
    });
    expect(decision.allowed).toBe(true);
  });

  test('a malformed recipient is refused whatever the allowlist says', () => {
    expect(egress.recipientAllowed('nope', {}).reason).toBe('malformed-recipient');
    expect(egress.recipientAllowed('A'.repeat(64), {}).reason).toBe('malformed-recipient');
  });
});

describe('ADR-2026 — redaction happens BEFORE egress, not after encryption', () => {
  test('the composed body carries NO sentinel — the reproduced leak is closed', () => {
    const r = runHook('UserPromptSubmit', {
      AGENTBOX_PRIVKEY_HEX: FAKE_SK,
      AGENTBOX_MIRROR_DRY_RUN: '1',
    }, { session_id: 's1', prompt: 'deploying with password=hunter2 and token=abc123 now' });
    expect(r.stderr).toMatch(/redacted-body/);
    expect(r.stderr).not.toMatch(/hunter2/);
    expect(r.stderr).not.toMatch(/abc123/);
    expect(r.stderr).toMatch(/<redacted>/);
  });

  test('the same holds on the explicit-recipient (legacy) configuration', () => {
    const r = runHook('UserPromptSubmit', {
      AGENTBOX_MIRROR_CHILD: '0',
      AGENTBOX_MIRROR_RECIPIENT_PUBKEY: FAKE_RECIPIENT,
      AGENTBOX_MIRROR_DRY_RUN: '1',
    }, { session_id: 's1', prompt: 'password=hunter2' });
    expect(r.stderr).not.toMatch(/hunter2/);
    expect(r.stderr).toMatch(/<redacted>/);
  });

  test('diagnostics never retain more than the wire: the dry run prints the REDACTED body', () => {
    const r = runHook('UserPromptSubmit', {
      AGENTBOX_PRIVKEY_HEX: FAKE_SK,
      AGENTBOX_MIRROR_DRY_RUN: '1',
    }, { session_id: 's1', prompt: 'nsec is 5b1c9e2d4a7f60318b2c5d9e7a4f1c0b3e6d8a2f4c1b9e7d0a3f6c8b2e5d9a71' });
    expect(r.stderr).not.toMatch(/5b1c9e2d4a7f/);
    expect(r.stderr).toMatch(/<redacted-hex>/);
  });
});

describe('ADR-2026 — network denial distinguishes skipped, attempted and accepted', () => {
  test('a denied relay yields ATTEMPTED then FAILED, never ACCEPTED', () => {
    const r = runHook('UserPromptSubmit', {
      AGENTBOX_PRIVKEY_HEX: FAKE_SK,
      NOSTR_MIRROR_RELAY: DENIED_RELAY,
    });
    expect(r.status).toBe(0); // best-effort: the session is never blocked
    if (/nostr-tools\/ws unavailable/.test(r.stderr)) {
      // The wrap libraries are not resolvable in this environment; the send path
      // could not be reached, so there is nothing to assert about the transport.
      expect(r.stderr).not.toMatch(/egress accepted/);
      return;
    }
    expect(r.stderr).toMatch(/egress attempted/);
    expect(r.stderr).toMatch(/egress failed/);
    expect(r.stderr).not.toMatch(/egress accepted/);
  });

  test('a DISABLED path never reaches "attempted" — the three states are distinct', () => {
    const off = runHook('UserPromptSubmit', { AGENTBOX_EGRESS: '0', AGENTBOX_PRIVKEY_HEX: FAKE_SK });
    expect(off.stderr).toMatch(/egress skipped/);
    expect(off.stderr).not.toMatch(/egress attempted/);
    expect(off.stderr).not.toMatch(/egress failed/);
  });

  test('exit zero is not proof of delivery on any of these paths', () => {
    for (const env of [
      { AGENTBOX_EGRESS: '0' },
      { AGENTBOX_PRIVKEY_HEX: FAKE_SK },
      {},
    ]) {
      expect(runHook('UserPromptSubmit', env).status).toBe(0);
    }
  });
});
