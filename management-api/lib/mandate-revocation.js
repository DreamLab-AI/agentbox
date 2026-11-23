'use strict';

/**
 * lib/mandate-revocation — revoke a mandate so it stops being enforced at the
 * pod, and publish the fact (AB-11).
 *
 * The old revoke rewrote the local registry and, when an operator stack happened
 * to be configured, signed a replacement event with THAT key (unsigned
 * otherwise, and a failed signer lookup was cached for the life of the
 * process). The pod, which never saw the mandate, was never told. Now:
 *
 *   1. preflight   the pod-owner signer exists and is `record.issuer`.
 *                  Otherwise 503 `signer_unavailable` and NOTHING changes:
 *                  there is no unsigned revoke.
 *   2. revoking    the entry is marked (atomic registry write). From here
 *                  voice-intent and `ensureMandate` deny.
 *   3. pod         the sidecar is re-rendered without the agent (PUT), or
 *                  DELETEd when none remain, then read back to confirm the
 *                  agent is gone. Failure: stays `revoking`, 502
 *                  `effective_at_pod:false`.
 *   4. publish     kind 30078, tags d=<urn> p=<agent> t=agent-mandate
 *                  status=revoked, `created_at = max(now, grant.created_at + 1)`,
 *                  signed by the same authority, to NOSTR_RELAYS; the local relay
 *                  must answer OK. Failure: `revoked_unpublished`, 200
 *                  `{ effective_at_pod: true, published: false }`.
 *   5. revoked     the tombstone. `ensureMandate` will not re-mint over it.
 *
 * Every step is idempotent, so {@link reconcileMandates} (run at start-up and on
 * an interval) re-drives `revoking` and `revoked_unpublished` after a crash, a
 * pod outage or a relay outage. It also rolls a stale `granting` back and
 * retires mandates past their expiry.
 *
 * A signer outage does not freeze revocation: the entry is marked `revoking`
 * locally BEFORE preflight (no signature is needed to stop honouring a mandate),
 * the call answers 503 `effective_at_pod:false`, and the reconciler drives the
 * pod and the relay once a signer is back. Work stuck longer than one interval is
 * logged as an error (`mandate.reconcile-overdue`).
 *
 * Revocation stays outside `authority.guard` (design decision d): it is a
 * reduction of authority, so it must never wait on an approval that a stuck
 * governance pipeline could withhold.
 */

const mandateLib = require('./mandate');
const registry = require('./mandate-registry');
const { runtime, preflight } = require('./mandate-runtime');
const { syncContainerSidecar, PodAclError } = require('./mandate-acl');
const { SignerUnavailable } = require('./mandate-signer');

const ALERT_LAG_DEFAULT_MS = 60_000;

const ACTION_DELETE = 3;
const DEFAULT_INTERVAL_MS = 60_000;

/** The pod still lets the agent in (HTTP 502, `effective_at_pod: false`). */
class RevokeError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'RevokeError';
    this.code = 'pod_acl_failed';
    this.status = 502;
    this.effective_at_pod = false;
    if (cause) this.cause = cause;
  }
}

const iso = (sec) => new Date(sec * 1000).toISOString();

function summary(entry, extra = {}) {
  return {
    urn: entry.record.urn,
    record: entry.record,
    state: entry.state,
    signed: entry.state === 'revoked',
    ...extra,
  };
}

/** Throw unless the entry under `key` is still the mandate `urn` (it may have been replaced mid-flight). */
function sameMandate(reg, key, urn) {
  if (!reg[key] || !reg[key].record || reg[key].record.urn !== urn) {
    throw new RevokeError('the mandate changed while it was being revoked; nothing further was written');
  }
  return reg[key];
}

/**
 * Step 2: mark the entry `revoking` (a local, atomic registry write; no
 * signature needed). Idempotent: an entry already revoking, revoked_unpublished
 * or revoked is left as it is.
 */
async function markRevoking({ rt, key, urn }) {
  const now = rt.now();
  let from = null;
  await registry.update((reg) => {
    const e = sameMandate(reg, key, urn);
    if (['revoking', 'revoked_unpublished', 'revoked'].includes(e.state)) return;
    from = e.state;
    Object.assign(e, { state: 'revoking', updated_at: iso(now) });
    e.record = { ...e.record, revoked: true };
  });
  if (from !== null) {
    const rec = registry.load()[key].record;
    registry.audit({ action: 'revoke.begin', urn, agent: mandateLib.normalisePubkey(rec.agent), container: rec.container, from, to: 'revoking' }, { now });
  }
}

/** Sign and publish `status=revoked` for a record, superseding `afterCreatedAt`. Never throws. */
async function publishRevokedEvent({ rt, signer, record, afterCreatedAt }) {
  let signed = null;
  try {
    signed = await signer.signEvent(mandateLib.buildMandateEvent({ ...record, revoked: true }, { status: 'revoked', nowSec: rt.now(), afterCreatedAt }));
    const pub = await rt.publisher.publish(signed);
    return { ok: pub.ok === true, signed, reason: pub.ok ? null : (pub.reason || 'relay refused') };
  } catch (err) {
    return { ok: false, signed, reason: `signing failed: ${err.message}` };
  }
}

/**
 * A grant that was signed but then rolled back may have reached a relay as an
 * `active` event. Publish the superseding `revoked` event for it, or leave
 * `revoke_event_pending` set so the reconciler does. Caller holds the container lock.
 *
 * @returns {Promise<boolean>} whether the revoke event was published
 */
async function settlePendingRevokeEvent({ rt, signer, key, logger }) {
  const entry = registry.load()[key];
  if (!entry || !entry.revoke_event_pending) return false;
  const urn = entry.record.urn;
  const r = await publishRevokedEvent({
    rt, signer, record: entry.record, afterCreatedAt: entry.grant_created_at || entry.record.issued_at,
  });
  if (!r.ok) {
    if (logger && logger.warn) logger.warn({ event: 'mandate.revoke-event-pending', urn, reason: r.reason }, 'mandate: the superseding revoke event is not yet published; reconciler will retry');
    return false;
  }
  await registry.update((reg) => {
    if (reg[key] && reg[key].record.urn === urn) {
      Object.assign(reg[key], { revoke_event_pending: false, revocation_event_id: r.signed.id, revocation_created_at: r.signed.created_at });
    }
  });
  registry.audit({ action: 'grant.revoke-published', urn, agent: mandateLib.normalisePubkey(entry.record.agent), container: entry.record.container, event_id: r.signed.id }, { now: rt.now() });
  return true;
}

/**
 * Steps 2-5 for one entry. The caller holds the container lock and has passed
 * preflight. Safe to run again from any state.
 */
async function drive({ rt, signer, client, key, urn, logger }) {
  const warn = (obj, msg) => { if (logger && logger.warn) logger.warn(obj, msg); };
  const entry0 = sameMandate(registry.load(), key, urn);
  const { record } = entry0;
  const owner = mandateLib.podOf(record);
  const agentHex = mandateLib.normalisePubkey(record.agent);
  const now = rt.now();
  const base = { urn, agent: agentHex, container: record.container };

  if (entry0.state === 'revoked') {
    return summary(entry0, { effective_at_pod: true, published: true, signed_event: null });
  }

  // 2. revoking
  await markRevoking({ rt, key, urn });

  // 3. the pod
  const others = registry.activeRecords(registry.load(), record.container, now)
    .filter((r) => r.urn !== urn && mandateLib.normalisePubkey(r.agent) !== agentHex);
  try {
    await syncContainerSidecar({ client, owner, container: record.container, active: others, absentAgents: [agentHex] });
  } catch (err) {
    if (!(err instanceof PodAclError) && !(err instanceof mandateLib.MandateError)) throw err;
    registry.audit({ action: 'revoke.pod-failed', ...base, state: 'revoking', error: err.message }, { now });
    warn({ event: 'mandate.revoke-pod-failed', urn, err: err.message }, 'mandate: pod ACL update failed; state stays revoking');
    throw new RevokeError(`the pod still lets the agent in: ${err.message}`, err);
  }
  registry.audit({ action: 'revoke.pod', ...base, state: 'revoking' }, { now });

  // 4. sign + publish
  const pub = await publishRevokedEvent({ rt, signer, record, afterCreatedAt: entry0.grant_created_at || record.issued_at });
  if (!pub.ok) {
    await registry.update((reg) => {
      Object.assign(sameMandate(reg, key, urn), { state: 'revoked_unpublished', updated_at: iso(now), last_error: pub.reason });
    });
    registry.audit({ action: 'revoke.unpublished', ...base, from: 'revoking', to: 'revoked_unpublished', error: pub.reason }, { now });
    rt.emit({
      action_type: ACTION_DELETE, source_urn: `did:nostr:${owner}`, duration_ms: 0,
      metadata: { kind: 'mandate-revoke', urn, agent: `did:nostr:${agentHex}`, container: record.container, state: 'revoked_unpublished', published: false },
    });
    return summary(registry.load()[key], { effective_at_pod: true, published: false, publish_error: pub.reason, signed_event: pub.signed });
  }

  // 5. tombstone
  const signed = pub.signed;
  await registry.update((reg) => {
    Object.assign(sameMandate(reg, key, urn), {
      state: 'revoked', signed: true, revocation_event_id: signed.id, revocation_created_at: signed.created_at,
      revoked_at: iso(now), updated_at: iso(now), last_error: undefined,
    });
  });
  registry.audit({ action: 'revoke.revoked', ...base, to: 'revoked', event_id: signed.id }, { now });
  rt.emit({
    action_type: ACTION_DELETE, source_urn: `did:nostr:${owner}`, duration_ms: 0,
    metadata: { kind: 'mandate-revoke', urn, agent: `did:nostr:${agentHex}`, container: record.container, state: 'revoked', published: true, event_id: signed.id },
  });
  return summary(registry.load()[key], { effective_at_pod: true, published: true, signed_event: signed });
}

/**
 * Revoke a mandate by `urn` or by `agent` + `container`.
 *
 * @param {object} args
 * @param {string} [args.urn]
 * @param {string} [args.agent]
 * @param {string} [args.container]
 * @param {object} [args.manifest]
 * @param {object} [args.logger]
 * @param {object} [args.deps] - see lib/mandate-runtime
 * @returns {Promise<null|{ urn, record, state, effective_at_pod: boolean, published: boolean, signed_event }>}
 *   null when no such mandate is recorded
 * @throws {SignerUnavailable} 503, nothing changed
 * @throws {RevokeError} 502, the pod still lets the agent in
 */
async function revokeMandate(args = {}) {
  const rt = runtime(args.manifest, args.deps);
  const reg = registry.load();
  let key = null;
  if (args.urn) {
    const hit = registry.findByUrn(reg, args.urn);
    key = hit ? hit.key : null;
  } else if (args.agent && args.container) {
    key = registry.keyFor(args.agent, args.container);
  }
  const entry = key ? reg[key] : null;
  if (!entry || !entry.record) return null;

  if (entry.state === 'revoked') {
    return summary(entry, { effective_at_pod: true, published: true, signed_event: null });
  }

  const urn = entry.record.urn;
  const issuerHex = mandateLib.normalisePubkey(entry.record.issuer);
  return registry.withContainerLock(entry.record.container, async () => {
    const cur = registry.load()[key];
    if (!cur || cur.record.urn !== urn) return null;
    if (cur.state === 'revoked') return summary(cur, { effective_at_pod: true, published: true, signed_event: null });

    // The mandate stops being honoured NOW: marking it needs no signature, so a
    // signer outage can no longer leave a revoke request with no effect.
    await markRevoking({ rt, key, urn });

    // 1. preflight — only the pod and relay work needs the signer.
    let auth;
    try {
      auth = await preflight(rt, issuerHex);
    } catch (err) {
      if (err instanceof SignerUnavailable) { err.effective_at_pod = false; err.state = 'revoking'; }
      throw err;
    }
    return drive({ rt, signer: auth.signer, client: auth.client, key, urn, logger: args.logger });
  });
}

/**
 * One reconciliation pass. Idempotent; never throws for a per-mandate problem.
 *
 *   - `revoking` / `revoked_unpublished`  → re-driven to `revoked`;
 *   - a stale `granting`                  → sidecar re-rendered without it, `failed`
 *                                           (and a `revoked` event published if the
 *                                           grant had been signed);
 *   - `failed` with `revoke_event_pending`→ the superseding revoke event published;
 *   - `active` past its expiry            → removed from the sidecar, `expired`.
 *
 * With no usable signer nothing is touched and the work is `deferred`. Work still
 * undone after more than `intervalMs` is logged as `mandate.reconcile-overdue`.
 *
 * @returns {Promise<{ revoked: number, rolledBack: number, expired: number, revokePublished: number, deferred: number, errors: string[] }>}
 */
async function reconcileMandates(args = {}) {
  const rt = runtime(args.manifest, args.deps);
  const logger = args.logger || {};
  const intervalMs = args.intervalMs || ALERT_LAG_DEFAULT_MS;
  const out = { revoked: 0, rolledBack: 0, expired: 0, revokePublished: 0, deferred: 0, errors: [] };
  const now = rt.now();

  const work = [];
  for (const [key, e] of Object.entries(registry.load())) {
    if (!e || !e.record) continue;
    if (e.state === 'revoking' || e.state === 'revoked_unpublished') work.push({ key, kind: 'revoke' });
    else if (e.state === 'granting') work.push({ key, kind: 'rollback' });
    else if (e.state === 'failed' && e.revoke_event_pending) work.push({ key, kind: 'pendingrevoke' });
    else if (e.state === 'active' && !registry.isEnforceable(e, now)) work.push({ key, kind: 'expire' });
  }

  const ageSec = (e, kind) => {
    if (kind === 'expire' && Number.isInteger(e.record.expires_at)) return now - e.record.expires_at;
    const t = Date.parse(e.updated_at || e.created_at || '');
    return Number.isFinite(t) ? now - Math.floor(t / 1000) : 0;
  };
  /** Work left undone: count it, and shout when it has waited longer than one interval. */
  const deferUnlessFresh = (e, kind, why) => {
    out.deferred += 1;
    const age = ageSec(e, kind);
    if (age * 1000 > intervalMs && logger.error) {
      logger.error({ event: 'mandate.reconcile-overdue', urn: e.record.urn, state: e.state, work: kind, age_s: age, reason: why },
        'mandate: reconciliation work is overdue and still not done');
    }
  };

  const authority = new Map(); // issuer -> { signer, client } | Error
  const getAuthority = async (issuerHex) => {
    if (!authority.has(issuerHex)) {
      try { authority.set(issuerHex, await preflight(rt, issuerHex)); } catch (err) { authority.set(issuerHex, err); }
    }
    return authority.get(issuerHex);
  };

  for (const { key, kind } of work) {
    const e = registry.load()[key];
    if (!e) continue;
    const issuerHex = mandateLib.normalisePubkey(e.record.issuer);
    const auth = await getAuthority(issuerHex);
    if (auth instanceof Error) {
      deferUnlessFresh(e, kind, auth.message);
      if (!(auth instanceof SignerUnavailable)) out.errors.push(`${e.record.urn}: ${auth.message}`);
      continue;
    }
    try {
      await registry.withContainerLock(e.record.container, async () => {
        const cur = registry.load()[key];
        if (!cur || cur.record.urn !== e.record.urn) return;
        const container = cur.record.container;
        const owner = mandateLib.podOf(cur.record);
        const urn = cur.record.urn;
        const agentHex = mandateLib.normalisePubkey(cur.record.agent);
        const others = () => registry.activeRecords(registry.load(), container, rt.now())
          .filter((r) => r.urn !== urn && mandateLib.normalisePubkey(r.agent) !== agentHex);

        if (kind === 'revoke' && (cur.state === 'revoking' || cur.state === 'revoked_unpublished')) {
          const res = await drive({ rt, signer: auth.signer, client: auth.client, key, urn, logger });
          if (res.state === 'revoked') out.revoked += 1; else deferUnlessFresh(cur, kind, res.publish_error || 'not yet published');
        } else if (kind === 'rollback' && cur.state === 'granting') {
          // Held under the container lock, so no grant is in flight: this one is stale.
          await syncContainerSidecar({ client: auth.client, owner, container, active: others(), absentAgents: [agentHex] });
          const signedBefore = !!cur.grant_created_at;                 // the active event had been signed
          await registry.update((reg) => {
            Object.assign(sameMandate(reg, key, urn), {
              state: 'failed', last_error: 'granting: rolled back by the reconciler', updated_at: iso(rt.now()),
              revoke_event_pending: signedBefore,
            });
          });
          registry.audit({ action: 'grant.rolled-back', urn, agent: agentHex, container, from: 'granting', to: 'failed' }, { now: rt.now() });
          out.rolledBack += 1;
          if (signedBefore && await settlePendingRevokeEvent({ rt, signer: auth.signer, key, logger })) out.revokePublished += 1;
        } else if (kind === 'pendingrevoke' && cur.state === 'failed' && cur.revoke_event_pending) {
          if (await settlePendingRevokeEvent({ rt, signer: auth.signer, key, logger })) out.revokePublished += 1;
          else deferUnlessFresh(cur, kind, 'relay did not accept the revoke event');
        } else if (kind === 'expire' && cur.state === 'active' && !registry.isEnforceable(cur, rt.now())) {
          await syncContainerSidecar({ client: auth.client, owner, container, active: others(), absentAgents: [agentHex] });
          await registry.update((reg) => {
            Object.assign(sameMandate(reg, key, urn), { state: 'expired', updated_at: iso(rt.now()) });
          });
          registry.audit({ action: 'mandate.expired', urn, agent: agentHex, container, from: 'active', to: 'expired' }, { now: rt.now() });
          out.expired += 1;
        }
      });
    } catch (err) {
      deferUnlessFresh(e, kind, err.message);
      out.errors.push(`${e.record.urn}: ${err.message}`);
      if (logger.warn) logger.warn({ event: 'mandate.reconcile-failed', urn: e.record.urn, kind, err: err.message }, 'mandate: reconcile step failed; will retry');
    }
  }
  return out;
}

/**
 * Run {@link reconcileMandates} now and then on an interval. Passes never
 * overlap. The timer is unref'd so it never holds the process open.
 *
 * @param {object} args - as reconcileMandates, plus `intervalMs`
 * @returns {{ stop(): void, runOnce(): Promise<object> }}
 */
function startReconciler(args = {}) {
  const intervalMs = args.intervalMs || DEFAULT_INTERVAL_MS;
  const logger = args.logger || {};
  let running = null;
  let stopped = false;

  const runOnce = () => {
    if (running) return running;
    running = reconcileMandates({ intervalMs, ...args })
      .catch((err) => {
        if (logger.warn) logger.warn({ event: 'mandate.reconcile-error', err: err.message }, 'mandate: reconcile pass failed');
        return { revoked: 0, rolledBack: 0, expired: 0, revokePublished: 0, deferred: 0, errors: [err.message] };
      })
      .finally(() => { running = null; });
    return running;
  };

  if (!stopped) runOnce();
  const timer = setInterval(() => { if (!stopped) runOnce(); }, intervalMs);
  if (timer.unref) timer.unref();
  return { stop() { stopped = true; clearInterval(timer); }, runOnce };
}

module.exports = { revokeMandate, reconcileMandates, startReconciler, RevokeError, driveRevocation: drive, settlePendingRevokeEvent, markRevoking };
