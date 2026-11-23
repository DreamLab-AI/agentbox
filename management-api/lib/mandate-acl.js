'use strict';

/**
 * lib/mandate-acl — make a mandate real at the pod (AB-11).
 *
 * Before this module a mandate was a record and a kind-30078 event that no pod
 * ever read: `acl_turtle` was rendered and never PUT, it targeted
 * `<container>/.acl` while solid-pod-rs's default Sidecar layout reads the
 * sibling `<container-without-slash>.acl`, and its root-relative IRIs carried no
 * owner block. The pod therefore never enforced a mandate.
 *
 * Here the container's WHOLE sidecar is rendered from the registry:
 *
 *   - an owner block (Read, Write, Append, Control) so a sidecar can never lock
 *     the owner out and no delegation can omit or overwrite the owner's Control
 *     (the forum pod-zone ACL pilot's convention, ADR-096);
 *   - one `<#mandate-<sha256(urn)>>` block per ACTIVE mandate, granting the
 *     agent its recorded modes on the full `/pods/<owner>/…` container, as both
 *     `acl:accessTo` and `acl:default`. Control is stripped at render time even
 *     from an old record, never delegated.
 *
 * The sidecar is PUT whole at `<container-without-slash>.acl`; when no active
 * mandate remains it is DELETEd. Every call is read back: a write the pod did
 * not honour is a failure, not a success.
 *
 * Requests are authenticated as the pod's Control holder through an injected
 * NIP-98 originator (lib/mandate-signer). The CONNECT origin (where bytes go)
 * and the SIGNED origin (what the pod matches the NIP-98 `u` tag against) are
 * separate: with a configured public origin solid-pod-rs matches against that
 * origin regardless of how the request arrived, so a loopback connection signs
 * the public URL.
 *
 * @see lib/mandate.js  @see lib/mandate-revocation.js  @see ADR amending ADR-043 D4.5
 */

const crypto = require('crypto');
const mandateLib = require('./mandate');

const DELEGABLE = ['Read', 'Write', 'Append'];
const OWNER_MODES = ['Read', 'Write', 'Append', 'Control'];
const DEFAULT_TIMEOUT_MS = 10000;
/** method+URL → second last signed, shared by every client in the process (clients are per-operation). */
const LAST_SIGNED = new Map();

/** A pod ACL operation failed: `phase` is `write` or `verify`. */
class PodAclError extends Error {
  /**
   * @param {string} message
   * @param {{ phase: 'write'|'verify', status?: number, cause?: Error }} info
   */
  constructor(message, { phase, status, cause } = {}) {
    super(message);
    this.name = 'PodAclError';
    this.phase = phase || 'write';
    this.status = status === undefined ? null : status;
    this.code = status === 401 || status === 403 ? 'pod_denied' : 'pod_acl_failed';
    if (cause) this.cause = cause;
  }
}

/**
 * The storage key solid-pod-rs reads a container's ACL from by default:
 * `<container-without-slash>.acl`. (The reference JS server keeps it inside the
 * container as `<container>/.acl`; solid-pod-rs's Sidecar layout ignores that.)
 *
 * @param {string} containerPath - e.g. `/pods/<hex>/proj/demo/`
 * @returns {string} e.g. `/pods/<hex>/proj/demo.acl`
 */
function sidecarPath(containerPath) {
  const path = mandateLib.normaliseContainer(containerPath);
  return `${path.slice(0, -1)}.acl`;
}

/** Fragment id for a mandate block: the hash of the URN, never the URN itself. */
function mandateFragment(urn) {
  return `mandate-${crypto.createHash('sha256').update(String(urn)).digest('hex')}`;
}

function modeClause(modes) {
  return modes.map((m) => `acl:${m}`).join(', ');
}

/**
 * Render the whole sidecar for a container: the owner block plus one block per
 * active mandate. Pure and deterministic (mandates are ordered by URN).
 *
 * @param {string} ownerHex        - pod owner's x-only pubkey hex
 * @param {string} containerPath   - `/pods/<ownerHex>/…/` (never the pod root)
 * @param {object[]} activeMandates - mandate records (the caller passes only active ones)
 * @returns {string} Turtle
 * @throws {mandateLib.MandateError} on a bad owner/container or a mandate for another container
 */
function renderContainerAcl(ownerHex, containerPath, activeMandates) {
  const owner = mandateLib.normalisePubkey(ownerHex);
  if (!owner || owner !== String(ownerHex).toLowerCase()) {
    throw new mandateLib.MandateError(`bad owner pubkey: ${ownerHex}`);
  }
  const container = mandateLib.containerInPod(containerPath, owner);

  const blocks = [];
  const sorted = [...(activeMandates || [])].sort((a, b) => String(a.urn).localeCompare(String(b.urn)));
  for (const record of sorted) {
    if (!record || !record.urn) throw new mandateLib.MandateError('a mandate record must carry a urn');
    if (mandateLib.podOf(record) !== owner) {
      throw new mandateLib.MandateError(`mandate ${record.urn} belongs to another pod`);
    }
    if (mandateLib.normaliseContainer(record.container) !== container) {
      throw new mandateLib.MandateError(`mandate ${record.urn} is for container ${record.container}, not ${container}`);
    }
    const agent = mandateLib.normalisePubkey(record.agent);
    if (!agent) throw new mandateLib.MandateError('record.agent is not a valid did:nostr');
    // Re-derive from the recorded modes but keep only what a delegate may hold:
    // an old record that carried Control loses it here instead of poisoning the
    // whole sidecar.
    const modes = DELEGABLE.filter((m) => (record.modes || []).some(
      (x) => String(x).replace(/^acl:/, '').toLowerCase() === m.toLowerCase(),
    ));
    if (modes.length === 0) continue;
    blocks.push(
      `<#${mandateFragment(record.urn)}> a acl:Authorization ;\n` +
      `    acl:agent <did:nostr:${agent}> ;\n` +
      `    acl:accessTo <${container}> ;\n` +
      `    acl:default <${container}> ;\n` +
      `    acl:mode ${modeClause(modes)} .\n`,
    );
  }

  const ownerBlock =
    '<#owner> a acl:Authorization ;\n' +
    `    acl:agent <did:nostr:${owner}> ;\n` +
    `    acl:accessTo <${container}> ;\n` +
    `    acl:default <${container}> ;\n` +
    `    acl:mode ${modeClause(OWNER_MODES)} .\n`;

  return ['@prefix acl: <http://www.w3.org/ns/auth/acl#> .\n', ownerBlock, ...blocks].join('\n');
}

/**
 * Minimal signed HTTP client for ACL sidecars. Not the pods adapter: that goes
 * out unsigned when `sign_requests` is off, and mandate enforcement must not.
 */
class PodAclClient {
  /**
   * @param {object} opts
   * @param {string} opts.connectBase - origin the bytes go to (e.g. http://127.0.0.1:8484)
   * @param {string} [opts.signedBase] - origin the pod matches NIP-98 against (its public origin); defaults to connectBase
   * @param {(method: string, url: string, body?: string) => Promise<string>} opts.nip98
   * @param {Function} [opts.fetchFn]
   * @param {number} [opts.timeoutMs]
   * @param {boolean} [opts.spaceReplays=true] - never sign the same method+URL twice in one second
   */
  constructor({ connectBase, signedBase, nip98, fetchFn, timeoutMs, spaceReplays } = {}) {
    if (!connectBase) throw new TypeError('PodAclClient: connectBase is required');
    if (typeof nip98 !== 'function') throw new TypeError('PodAclClient: nip98 originator is required');
    this._connect = String(connectBase).replace(/\/+$/, '');
    this._signed = String(signedBase || connectBase).replace(/\/+$/, '');
    this._nip98 = nip98;
    this._fetch = fetchFn || ((...a) => fetch(...a));
    this._timeout = timeoutMs || DEFAULT_TIMEOUT_MS;
    this._space = spaceReplays !== false;
  }

  async _request(method, path, { body, contentType, accept } = {}) {
    // A NIP-98 event carries no nonce: two requests for the same method+URL in
    // the same second sign to the SAME event id, and the pod rejects the second as
    // a replay (observed: the post-write read-back GET after an earlier GET). Wait
    // for the next second rather than weaken the pod's replay check.
    if (this._space) {
      const id = `${this._signed} ${method} ${path}`;
      const nowSec = Math.floor(Date.now() / 1000);
      if (LAST_SIGNED.get(id) === nowSec) {
        await new Promise((r) => setTimeout(r, (nowSec + 1) * 1000 - Date.now() + 5));
      }
      LAST_SIGNED.set(id, Math.floor(Date.now() / 1000));
      if (LAST_SIGNED.size > 512) LAST_SIGNED.delete(LAST_SIGNED.keys().next().value);
    }
    // Sign first: a request that cannot be authenticated is never sent.
    const header = await this._nip98(method, `${this._signed}${path}`, body);
    if (!header) throw new Error('the NIP-98 originator declined to sign');
    const headers = { Authorization: header };
    if (contentType) headers['Content-Type'] = contentType;
    if (accept) headers.Accept = accept;
    const init = { method, headers, signal: AbortSignal.timeout(this._timeout) };
    if (body !== undefined) init.body = body;
    return this._fetch(`${this._connect}${path}`, init);
  }

  put(path, turtle) { return this._request('PUT', path, { body: turtle, contentType: 'text/turtle' }); }
  del(path) { return this._request('DELETE', path); }
  get(path) { return this._request('GET', path, { accept: 'text/turtle' }); }
}

function writeFailure(what, res) {
  return new PodAclError(`pod refused ${what}: HTTP ${res.status}`, { phase: 'write', status: res.status });
}

/**
 * Make the pod's sidecar for `container` equal the registry: PUT the rendered
 * whole when mandates are active, DELETE it when none remain, then GET it back
 * and confirm. Idempotent (a DELETE of an absent sidecar succeeds).
 *
 * @param {object} args
 * @param {PodAclClient} args.client
 * @param {string} args.owner
 * @param {string} args.container
 * @param {object[]} args.active        - records that must be in the sidecar
 * @param {string[]} [args.absentAgents] - agent pubkeys that must NOT appear afterwards
 * @returns {Promise<{ action: 'put'|'delete', path: string, status: number }>}
 * @throws {PodAclError}
 */
async function syncContainerSidecar({ client, owner, container, active, absentAgents = [] }) {
  const path = sidecarPath(container);
  const present = (active || []).map((m) => mandateLib.normalisePubkey(m.agent));
  const absent = absentAgents.map((a) => mandateLib.normalisePubkey(a)).filter(Boolean)
    .filter((a) => !present.includes(a));
  const wantEmpty = present.length === 0;

  let res;
  try {
    if (wantEmpty) {
      res = await client.del(path);
      if (![200, 202, 204, 404, 410].includes(res.status)) throw writeFailure(`DELETE ${path}`, res);
    } else {
      const turtle = renderContainerAcl(owner, container, active);
      res = await client.put(path, turtle);
      if (![200, 201, 204].includes(res.status)) throw writeFailure(`PUT ${path}`, res);
    }
  } catch (err) {
    if (err instanceof PodAclError) throw err;
    if (err instanceof mandateLib.MandateError) throw err;
    throw new PodAclError(`${wantEmpty ? 'DELETE' : 'PUT'} ${path} failed: ${err.message}`, { phase: 'write', cause: err });
  }
  const status = res.status;

  // Read back what the pod actually holds.
  let back;
  let text = '';
  try {
    back = await client.get(path);
    text = back.status === 200 ? String(await back.text()).toLowerCase() : '';
  } catch (err) {
    throw new PodAclError(`read-back of ${path} failed: ${err.message}`, { phase: 'verify', cause: err });
  }
  if (wantEmpty) {
    if (![404, 410].includes(back.status)) {
      throw new PodAclError(`sidecar ${path} still answers HTTP ${back.status} after DELETE`, { phase: 'verify', status: back.status });
    }
  } else {
    if (back.status !== 200) {
      throw new PodAclError(`read-back of ${path} answered HTTP ${back.status}`, { phase: 'verify', status: back.status });
    }
    for (const a of present) {
      if (!text.includes(a)) throw new PodAclError(`sidecar ${path} does not contain agent ${a} after PUT`, { phase: 'verify' });
    }
  }
  for (const a of absent) {
    if (text.includes(a)) throw new PodAclError(`sidecar ${path} still contains removed agent ${a}`, { phase: 'verify' });
  }
  return { action: wantEmpty ? 'delete' : 'put', path, status };
}

module.exports = {
  PodAclClient,
  PodAclError,
  renderContainerAcl,
  sidecarPath,
  syncContainerSidecar,
  mandateFragment,
};
