'use strict';

/**
 * lib/mandate-grant — grant a mandate so the pod actually enforces it (AB-11).
 *
 * Order, all under the per-container lock (the sidecar is rendered from every
 * active mandate on the container, so the whole span must be exclusive):
 *
 *   1. preflight   the pod-owner signer exists, is the issuer, signs a real
 *                  NIP-98 header. 503 `signer_unavailable`, nothing changed.
 *   2. mint        `createMandate` (validated, content-addressed URN), entry
 *                  recorded as `granting`. Not enforceable yet.
 *   3. PUT         the whole sidecar (owner + every active mandate + this one)
 *                  at `<container-without-slash>.acl`, read back.
 *   4. sign        the kind-30078 envelope with the SAME authority (fail closed:
 *                  there is no unsigned grant, which amends ADR-043 D4.5).
 *   5. publish     to NOSTR_RELAYS; the local relay must answer OK.
 *   6. mark        `active`.
 *
 * If 3, 4 or 5 fails the sidecar is re-rendered WITHOUT the mandate and the
 * entry becomes `failed`; if even that rollback fails the entry stays
 * `granting` and the reconciler (lib/mandate-revocation) finishes it.
 *
 * A revoked mandate is a tombstone: `ensureMandate` (regrant = false) refuses to
 * re-mint over it. Only the operator's explicit POST /v1/mandate (regrant = true)
 * replaces one, and the new event is guaranteed to supersede the revoke.
 */

const mandateLib = require('./mandate');
const registry = require('./mandate-registry');
const { runtime, preflight } = require('./mandate-runtime');
const { renderContainerAcl, syncContainerSidecar, PodAclError } = require('./mandate-acl');
const { driveRevocation, settlePendingRevokeEvent } = require('./mandate-revocation');

const TOMBSTONE_STATES = ['revoking', 'revoked_unpublished', 'revoked'];
const ACTION_CREATE = 2;

/** A revoked mandate may not be silently re-minted (HTTP 409). */
class MandateRevokedError extends Error {
  constructor(urn, state) {
    super(`mandate ${urn} was revoked (${state}); re-granting needs an explicit operator grant`);
    this.name = 'MandateRevokedError';
    this.code = 'mandate_revoked';
    this.urn = urn;
    this.state = state;
  }
}

/** The grant could not be made effective; nothing is left enforced (HTTP 502). */
class GrantError extends Error {
  /** @param {string} message @param {'pod_acl_failed'|'foreign_acl'|'revocation_pending'|'sign_failed'|'publish_failed'} code @param {Error} [cause] @param {number} [status] */
  constructor(message, code, cause, status = 502) {
    super(message);
    this.name = 'GrantError';
    this.code = code;
    this.status = status;
    if (cause) this.cause = cause;
  }
}

const iso = (sec) => new Date(sec * 1000).toISOString();

/**
 * Grant (or return the existing active) mandate for `agent` over `container`.
 *
 * @param {object} args
 * @param {string} args.issuer     - the pod owner (did or hex)
 * @param {string} args.agent
 * @param {string} args.container  - `/pods/<issuer>/…/`
 * @param {string[]} [args.modes]
 * @param {number|null} [args.expiresAt]
 * @param {boolean} [args.regrant=false] - replace a tombstone (operator's explicit grant)
 * @param {boolean} [args.anyContainer=false] - allow a container outside `/pods/<owner>/proj/` (only the operator's explicit POST /v1/mandate sets this)
 * @param {object} [args.manifest]
 * @param {object} [args.logger]
 * @param {object} [args.deps]     - see lib/mandate-runtime
 * @returns {Promise<{ urn, record, acl_turtle, signed: true, signed_event, reused }>}
 * @throws {mandateLib.MandateError|import('./mandate-signer').SignerUnavailable|MandateRevokedError|GrantError|registry.RegistryError}
 */
async function grantMandate(args = {}) {
  const rt = runtime(args.manifest, args.deps);
  const logger = args.logger || {};
  const warn = (obj, msg) => { if (logger.warn) logger.warn(obj, msg); };
  const now = rt.now();

  // Pure validation first: a bad request never reaches the lock, the signer or the pod.
  const { urn, record } = mandateLib.createMandate({
    issuer: args.issuer,
    agent: args.agent,
    container: args.container,
    modes: args.modes,
    expiresAt: args.expiresAt,
    issuedAt: now,
  });
  const owner = mandateLib.podOf(record);
  // Session and lazy grants live under proj/<slug>/ only; the explicit operator grant may go elsewhere.
  if (!args.anyContainer) mandateLib.assertProjContainer(record.container, owner);
  const issuerHex = mandateLib.normalisePubkey(record.issuer);
  const agentHex = mandateLib.normalisePubkey(record.agent);
  const key = registry.keyFor(agentHex, record.container);

  return registry.withContainerLock(record.container, async () => {
    const regNow = registry.load();
    const existing = regNow[key];

    if (existing && registry.isEnforceable(existing, now)) {
      const active = registry.activeRecords(regNow, record.container, now);
      return {
        urn: existing.record.urn,
        record: existing.record,
        acl_turtle: renderContainerAcl(owner, record.container, active),
        signed: true,
        signed_event: null,
        reused: true,
      };
    }
    if (!args.regrant) {
      // A tombstone governs the agent's access to every container it overlaps: a
      // mandate on a PARENT of a revoked container would re-admit the agent via
      // acl:default, and one on a descendant is the revoked scope again.
      for (const e of Object.values(regNow)) {
        if (!e || !e.record || !TOMBSTONE_STATES.includes(e.state)) continue;
        if (mandateLib.normalisePubkey(e.record.agent) !== agentHex) continue;
        if (mandateLib.containersOverlap(e.record.container, record.container)) {
          throw new MandateRevokedError(e.record.urn, e.state);
        }
      }
    }

    // 1. preflight — nothing is written until a pod-owner signer is proven.
    const { signer, client } = await preflight(rt, issuerHex);

    // An explicit regrant never overtakes an unfinished revocation: finish it (pod,
    // then the relay) first, or refuse. Otherwise the new `active` event could be
    // superseded by a stale revoke, or the old revoke could stay unpublished.
    if (existing && (existing.state === 'revoking' || existing.state === 'revoked_unpublished')) {
      let driven;
      try {
        driven = await driveRevocation({ rt, signer, client, key, urn: existing.record.urn, logger });
      } catch (err) {
        throw new GrantError(`the earlier revocation is not finished: ${err.message}`, 'revocation_pending', err, 409);
      }
      if (driven.state !== 'revoked') {
        throw new GrantError(`the earlier revocation is not finished: ${driven.publish_error || driven.state}`, 'revocation_pending', undefined, 409);
      }
    }
    const existingNow = registry.load()[key];

    // The new event must supersede whatever this slot last carried.
    const lastEventAt = existingNow
      ? Math.max(existingNow.grant_created_at || 0, existingNow.revocation_created_at || 0) || undefined
      : undefined;

    // 2. record as `granting` (not enforceable) before anything touches the pod.
    await registry.update((reg) => {
      reg[key] = { record, state: 'granting', signed: false, signed_event_id: null, created_at: iso(now), updated_at: iso(now) };
    });
    registry.audit({ action: 'grant.begin', urn, agent: agentHex, container: record.container, from: existing ? existing.state : null, to: 'granting' }, { now });

    const othersActive = () => registry.activeRecords(registry.load(), record.container, now)
      .filter((r) => r.urn !== urn && mandateLib.normalisePubkey(r.agent) !== agentHex);

    const rollback = async (why, code) => {
      try {
        await syncContainerSidecar({ client, owner, container: record.container, active: othersActive(), absentAgents: [agentHex] });
      } catch (err) {
        // Cannot prove the pod is clean: stay `granting` so the reconciler retries.
        warn({ event: 'mandate.grant-rollback-failed', urn, err: err.message }, 'mandate: rollback could not be confirmed; reconciler will retry');
        registry.audit({ action: 'grant.rollback-pending', urn, agent: agentHex, container: record.container, error: err.message }, { now });
        return;
      }
      await registry.update((reg) => {
        if (reg[key] && reg[key].record.urn === urn) {
          Object.assign(reg[key], { state: 'failed', last_error: `${code}: ${why}`, updated_at: iso(rt.now()) });
        }
      });
      registry.audit({ action: 'grant.failed', urn, agent: agentHex, container: record.container, from: 'granting', to: 'failed', reason: code, error: why }, { now });
      // If the `active` event was signed, it may have reached a relay: supersede it.
      try { await settlePendingRevokeEvent({ rt, signer, key, logger }); } catch (err) {
        warn({ event: 'mandate.grant-revoke-event-failed', urn, err: err.message }, 'mandate: could not publish the superseding revoke');
      }
    };

    // 3. PUT the whole sidecar and read it back.
    try {
      await syncContainerSidecar({ client, owner, container: record.container, active: [...othersActive(), record] });
    } catch (err) {
      if (!(err instanceof PodAclError)) throw err;
      await rollback(err.message, err.code === 'foreign_acl' ? 'foreign_acl' : 'pod_acl_failed');
      if (err.code === 'foreign_acl') throw new GrantError(err.message, 'foreign_acl', err, 409);
      throw new GrantError(`the pod did not take the ACL: ${err.message}`, 'pod_acl_failed', err);
    }

    // 4. sign — fail closed.
    let signed;
    try {
      signed = await signer.signEvent(mandateLib.buildMandateEvent(record, { status: 'active', nowSec: now, afterCreatedAt: lastEventAt }));
    } catch (err) {
      await rollback(err.message, 'sign_failed');
      throw new GrantError(`the mandate event could not be signed: ${err.message}`, 'sign_failed', err);
    }

    // From here an `active` event exists that a relay may see: record it BEFORE publishing,
    // so a crash, a failed publish or the reconciler's rollback knows to supersede it.
    await registry.update((reg) => {
      Object.assign(reg[key], { grant_created_at: signed.created_at, signed_event_id: signed.id, revoke_event_pending: true });
    });

    // 5. publish — the local relay must answer OK.
    const pub = await rt.publisher.publish(signed);
    if (!pub.ok) {
      await rollback(pub.reason || 'relay refused', 'publish_failed');
      throw new GrantError(`the mandate event was not published: ${pub.reason || 'relay refused'}`, 'publish_failed');
    }

    // 6. active.
    await registry.update((reg) => {
      Object.assign(reg[key], {
        state: 'active', signed: true, signed_event_id: signed.id, grant_created_at: signed.created_at,
        updated_at: iso(rt.now()), last_error: undefined, revoke_event_pending: false,
      });
    });
    registry.audit({ action: 'grant.active', urn, agent: agentHex, container: record.container, from: 'granting', to: 'active', event_id: signed.id }, { now });
    rt.emit({
      action_type: ACTION_CREATE,
      source_urn: `did:nostr:${owner}`,
      duration_ms: 0,
      metadata: { kind: 'mandate-grant', urn, agent: `did:nostr:${agentHex}`, container: record.container, state: 'active', event_id: signed.id },
    });
    return {
      urn,
      record,
      acl_turtle: renderContainerAcl(owner, record.container, registry.activeRecords(registry.load(), record.container, now)),
      signed: true,
      signed_event: signed,
      reused: false,
    };
  });
}

module.exports = { grantMandate, MandateRevokedError, GrantError };
