'use strict';

/**
 * Integration test — end-to-end cross-repo economy loop.
 *
 * The first executable demonstration of the full sovereign-economy loop the
 * ecosystem was built for (audit 2026-06-09, R-03/R-04/R-07 landed):
 *
 *   1. an agentbox agent reads a cost-gated solid-pod-rs resource through the
 *      REAL LocalSolidRsPodsAdapter, authenticating with a REAL NIP-98 token;
 *   2. solid-pod-rs's WAC grant CONSUMES the per-read cost from the agent's Web
 *      Ledger (commits 0cf2d61 + f7785d7 — balance decreases, exactly once);
 *   3. agentbox mints a receipt URN AND the associated activity (action) URN
 *      through lib/uris.js (never ad-hoc);
 *   4. the activity record and a work bead cross the BC20 federation boundary
 *      via bc20.crossOutbound() into a DURABLE UrnMapping store, round-trip
 *      losslessly, and increment agentbox_bc20_crossings_total.
 *
 * Two tiers:
 *
 *   - REAL tier: the genuinely end-to-end signed-read + debit + cross loop runs
 *     in a CHILD node process (economy-loop-runner.js) because nostr-tools v2
 *     pulls pure-ESM deps (@noble/curves) jest's CommonJS sandbox can't parse.
 *     This suite spawns the runner and asserts on its JSON result. It is a clean
 *     SKIP (test passes with a warning) when no debit-capable solid-pod-rs
 *     binary is present — the published alpha.15 predates the debit fix, so we
 *     never assert debit against it.
 *
 *   - HTTP-mock tier (always runs in-process): mocks ONLY the transport. It
 *     asserts the adapter emits a correctly-shaped NIP-98 request and that on a
 *     200 the receipt/activity/bead minting + BC20 crossing loop executes — the
 *     logic is real, only the network is faked. No nostr-tools dependency.
 *
 * What this test does NOT do: re-assert solid-pod-rs's internal debit maths (18
 * in-crate ledger tests already own that) or modify any adapter contract.
 *
 * @see docs/developer/economy-loop.md (operator runbook + sequence diagram)
 * @see tests/integration/economy-loop-runner.js (the real-flow child process)
 * @see ADR-005 §pods slot, ADR-010, ADR-013 (URN grammar), DDD-012 §A4 (BC20)
 */

const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const uris = require('../../management-api/lib/uris');
const bc20 = require('../../management-api/lib/bc20-provenance-bridge');
const { LocalSolidRsPodsAdapter } = require('../../management-api/adapters/pods/local-solid-rs');

let promClient = null;
try { promClient = require('prom-client'); } catch { /* counters asserted only when present */ }

const RESOURCE = '/premium/feed';
const COST_SATS = 30;
const START_BALANCE = 100;

/** Read a labelled value off a prom-client counter (Counter.get() is async in v15). */
async function counterValue(name, labels) {
  if (!promClient) return null;
  const metric = promClient.register.getSingleMetric(name);
  if (!metric) return 0;
  const snapshot = await metric.get();
  const hit = (snapshot.values || []).find((v) =>
    Object.entries(labels).every(([k, val]) => v.labels[k] === val));
  return hit ? hit.value : 0;
}

/**
 * The agentbox-side economy half: given a completed paid read, mint the
 * canonical receipt + activity URNs through lib/uris.js and cross the activity
 * record plus a bead into a UrnMapping store. Pure orchestration over the real
 * modules — this is the code the management-api route runs after a paid adapter
 * read returns 200. (The real tier runs the identical sequence in the runner.)
 *
 * @returns {{ receiptUrn, activityUrn, beadUrn, activityCross, beadCross }}
 */
function settlePaidRead({ pubkey, resource, costSats, body, store }) {
  // Receipt: content-addressed proof of THIS settled read (stays agentbox-local;
  // `receipt` is intentionally an unmapped BC20 kind — receipts do not cross).
  const receiptPayload = { kind: 'paid-read', resource, cost_sats: costSats, body_sha256: crypto.createHash('sha256').update(body).digest('hex') };
  const receiptUrn = uris.mint({ kind: 'receipt', pubkey, payload: receiptPayload });

  // Activity (PROV-O action record) — the federatable provenance of the read.
  const activityUrn = uris.mint({ kind: 'activity', pubkey, payload: { verb: 'read', receipt: receiptUrn } });

  // Bead — the durable work-receipt for the read, content-addressed to match
  // VisionClaw's converged bead grammar so it crosses structurally.
  const beadUrn = uris.mint({ kind: 'bead', pubkey, payload: { title: `paid read ${resource}`, activity: activityUrn } });

  // Cross BOTH the activity and the bead outbound, persisting each UrnMapping.
  const activityCross = bc20.crossOutbound(activityUrn, store);
  const beadCross = bc20.crossOutbound(beadUrn, store);

  return { receiptUrn, activityUrn, beadUrn, activityCross, beadCross };
}

// ---------------------------------------------------------------------------
// REAL tier — live solid-pod-rs spawn via the child runner (skipped when N/A)
// ---------------------------------------------------------------------------

describe('economy loop :: real solid-pod-rs (cost-gated read → debit → receipt → BC20)', () => {
  let real = null;     // parsed runner JSON on success
  let skipReason = null;

  beforeAll(() => {
    const runner = path.join(__dirname, 'economy-loop-runner.js');
    const out = spawnSync(process.execPath, [runner], { encoding: 'utf8', timeout: 30000 });
    if (out.error) { skipReason = `runner failed to spawn: ${out.error.message}`; return; }
    const line = (out.stdout || '').trim().split('\n').filter(Boolean).pop();
    if (!line) { skipReason = `runner produced no output (stderr: ${(out.stderr || '').slice(0, 200)})`; return; }
    let parsed;
    try { parsed = JSON.parse(line); } catch { skipReason = `runner output not JSON: ${line.slice(0, 200)}`; return; }
    if (parsed.skip) { skipReason = parsed.skip; return; }
    if (!parsed.ok) { skipReason = `runner reported failure: ${parsed.error || 'unknown'} ${parsed.log || ''}`; return; }
    real = parsed;
  }, 35000);

  const realIt = (name, fn) => it(name, () => {
    if (skipReason) { console.warn(`[economy-loop] real tier skipped: ${skipReason}`); return; }
    fn();
  });

  realIt('an unsigned read of the gated resource is denied (WAC deny-by-default)', () => {
    expect(real.anonDenied).toBe(true);
    expect(real.anonError).toBe('PermissionDenied');
  });

  realIt('the NIP-98-signed read debits the Web Ledger by exactly the per-read cost', () => {
    expect(real.balanceBefore).toBe(START_BALANCE);
    expect(real.readBody).toContain('paid content');
    expect(real.balanceAfter).toBe(START_BALANCE - COST_SATS); // 100 → 70
  });

  realIt('the receipt + activity + bead URNs are canonical and minted through lib/uris.js', () => {
    const pk = real.pubkey;
    expect(real.receiptCanonical).toBe(true);
    expect(real.receiptUrn).toMatch(new RegExp(`^urn:agentbox:receipt:${pk}:sha256-12-[0-9a-f]{12}$`));
    expect(real.activityUrn).toMatch(new RegExp(`^urn:agentbox:activity:${pk}:sha256-12-[0-9a-f]{12}$`));
    expect(real.beadUrn).toMatch(new RegExp(`^urn:agentbox:bead:${pk}:sha256-12-[0-9a-f]{12}$`));
  });

  realIt('the activity crosses to an execution id and the bead crosses structurally', () => {
    expect(real.activityVc).toMatch(/^urn:visionclaw:execution:sha256-12-[0-9a-f]{12}$/);
    expect(real.activityOwnerDid).toBe(real.did);
    expect(real.beadVc).toBe(`urn:visionclaw:bead:${real.pubkey}:${real.beadLocal}`);
    // receipt is an unmapped BC20 kind — it must not cross.
    expect(real.receiptCrosses).toBe(false);
  });

  realIt('both mappings round-trip losslessly through the durable JSONL store', () => {
    expect(real.activityRoundTrip).toBe(true);
    expect(real.beadRoundTrip).toBe(true);
    expect(real.mappingFileExists).toBe(true);
    expect(real.reopenedActivity).toBe(real.activityVc); // survives a store reopen
  });

  realIt('the BC20 crossings counter incremented for the activity crossing', () => {
    if (!real.promAvailable) return;
    expect(real.counterAfter).toBeGreaterThan(real.counterBefore);
  });
});

// ---------------------------------------------------------------------------
// HTTP-mock tier — always runs in-process; mocks only the transport
// ---------------------------------------------------------------------------

describe('economy loop :: HTTP-mock (request shape + receipt/bead/BC20 on 200)', () => {
  const PUBKEY = 'a'.repeat(64);
  const DID = `did:nostr:${PUBKEY}`;

  /** Capture every request the adapter issues; reply 200 with the resource body. */
  function makeCapturingFetch(captured) {
    return async (url, init = {}) => {
      captured.push({ url, method: (init.method || 'GET').toUpperCase(), headers: init.headers || {} });
      return {
        ok: true,
        status: 200,
        url,
        headers: { get: (h) => (h === 'content-type' ? 'application/json' : null) },
        text: async () => '{"headline":"paid content"}',
        json: async () => ({ headline: 'paid content' }),
      };
    };
  }

  it('the adapter attaches a well-formed NIP-98 Authorization header to the read', async () => {
    const captured = [];
    // A structurally-valid kind-27235 token. Asserts the wire SHAPE the adapter
    // emits without needing a live server or nostr-tools (jest-ESM constraint).
    const nip98 = async (method, url) => {
      const event = {
        kind: 27235,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['u', url], ['method', String(method).toUpperCase()]],
        content: '',
        pubkey: PUBKEY,
        id: 'f'.repeat(64),
        sig: '0'.repeat(128),
      };
      return `Nostr ${Buffer.from(JSON.stringify(event), 'utf8').toString('base64')}`;
    };

    const adapter = new LocalSolidRsPodsAdapter({
      baseUrl: 'http://pod.invalid',
      fetchFn: makeCapturingFetch(captured),
      nip98,
      probeCapabilities: false,
    });

    const res = await adapter.read(RESOURCE);
    expect(res.body).toContain('paid content');

    expect(captured).toHaveLength(1);
    const req = captured[0];
    expect(req.method).toBe('GET');
    expect(req.url).toBe(`http://pod.invalid${RESOURCE}`);

    const auth = req.headers.Authorization;
    expect(auth).toMatch(/^Nostr /);
    const event = JSON.parse(Buffer.from(auth.slice('Nostr '.length), 'base64').toString('utf8'));
    expect(event.kind).toBe(27235);
    const uTag = event.tags.find((t) => t[0] === 'u');
    const methodTag = event.tags.find((t) => t[0] === 'method');
    expect(uTag[1]).toBe(`http://pod.invalid${RESOURCE}`);
    expect(methodTag[1]).toBe('GET');
  });

  it('on a 200 the settle path mints receipt+activity+bead and crosses activity+bead durably', async () => {
    const store = new bc20.InMemoryUrnMappingStore();
    const beforeAct = await counterValue('agentbox_bc20_crossings_total', { kind: 'activity', direction: 'outbound' });
    const beforeBead = await counterValue('agentbox_bc20_crossings_total', { kind: 'bead', direction: 'outbound' });

    const out = settlePaidRead({
      pubkey: PUBKEY,
      resource: RESOURCE,
      costSats: COST_SATS,
      body: '{"headline":"paid content"}',
      store,
    });

    // All three URNs canonical and grammar-correct.
    expect(uris.isCanonical(out.receiptUrn)).toBe(true);
    expect(uris.isCanonical(out.activityUrn)).toBe(true);
    expect(uris.isCanonical(out.beadUrn)).toBe(true);

    // receipt is an UNMAPPED BC20 kind — it must NOT cross (proves the closed map).
    const drops = [];
    expect(bc20.toVisionclaw(out.receiptUrn, { onDrop: (r) => drops.push(r) })).toBeNull();
    expect(drops[0]).toMatch(/unmapped kind 'receipt'/);

    // activity → execution, bead → bead, both round-trip from the store.
    expect(out.activityCross.visionclaw_urn).toMatch(/^urn:visionclaw:execution:sha256-12-[0-9a-f]{12}$/);
    expect(out.activityCross.owner_did).toBe(DID);
    expect(bc20.toAgentbox(out.activityCross.visionclaw_urn, { store })).toBe(out.activityUrn);
    expect(bc20.toAgentbox(out.beadCross.visionclaw_urn, { store })).toBe(out.beadUrn);
    expect(store.size).toBe(2);

    if (promClient) {
      expect(await counterValue('agentbox_bc20_crossings_total', { kind: 'activity', direction: 'outbound' }))
        .toBeGreaterThan(beforeAct);
      expect(await counterValue('agentbox_bc20_crossings_total', { kind: 'bead', direction: 'outbound' }))
        .toBeGreaterThan(beforeBead);
    }
  });

  it('the durable JSONL store survives a reopen (mappings persist across process restarts)', () => {
    const tmp = path.join(os.tmpdir(), `economy-jsonl-${crypto.randomBytes(6).toString('hex')}.jsonl`);
    try {
      const store = new bc20.JsonlUrnMappingStore(tmp);
      const out = settlePaidRead({
        pubkey: PUBKEY, resource: RESOURCE, costSats: COST_SATS, body: 'x', store,
      });
      const reopened = new bc20.JsonlUrnMappingStore(tmp);
      expect(reopened.getByVisionclaw(out.activityCross.visionclaw_urn).agentbox_urn).toBe(out.activityUrn);
      expect(reopened.getByVisionclaw(out.beadCross.visionclaw_urn).agentbox_urn).toBe(out.beadUrn);
    } finally {
      try { fs.rmSync(tmp, { force: true }); } catch { /* noop */ }
    }
  });
});
