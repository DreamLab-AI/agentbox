'use strict';

/**
 * lib/mandate-runtime — the production collaborators of the mandate lifecycle,
 * with an injection seam so tests substitute the pod, signer and relay.
 *
 * `deps` (all optional):
 *   resolveSigner(manifest) → signer   pod-owner signer (lib/mandate-signer)
 *   podEndpoints(manifest)  → { connectBase, signedBase }
 *   fetchFn                            HTTP to the pod
 *   publisher                          { publish(event) → { ok, reason, results } }
 *   now()                              Unix seconds
 *   emit(event)                        agent-events sink (emitAgentAction)
 */

const mandateSigner = require('./mandate-signer');
const { PodAclClient } = require('./mandate-acl');
const { createPublisher } = require('./mandate-publish');

let sharedPublisher = null;
function defaultPublisher() {
  if (!sharedPublisher) sharedPublisher = createPublisher();
  return sharedPublisher;
}

function defaultEmit(event) {
  try {
    const { agentEventPublisher } = require('../utils/agent-event-publisher');
    agentEventPublisher.emitAgentAction(event);
  } catch (_) { /* the event stream is advisory; the audit file is the record */ }
}

/** Resolve every collaborator, defaulting to production. */
function runtime(manifest, deps = {}) {
  return {
    resolveSigner: deps.resolveSigner || ((m) => mandateSigner.resolveMandateSigner(m)),
    podEndpoints: deps.podEndpoints || ((m) => mandateSigner.podEndpoints(m)),
    fetchFn: deps.fetchFn,
    spaceReplays: deps.spaceReplays,
    publisher: deps.publisher || defaultPublisher(),
    now: deps.now || (() => Math.floor(Date.now() / 1000)),
    emit: deps.emit || defaultEmit,
    manifest,
  };
}

/**
 * Preflight: resolve the signer, require it to be the issuer, and build the
 * signed pod client. Throws SignerUnavailable; sends and changes nothing.
 *
 * @returns {Promise<{ signer: object, client: PodAclClient }>}
 */
async function preflight(rt, issuerHex) {
  const signer = await rt.resolveSigner(rt.manifest);
  const { connectBase, signedBase } = rt.podEndpoints(rt.manifest);
  await mandateSigner.assertOwnerSigner({ signer, issuerHex, signedBase });
  const client = new PodAclClient({
    connectBase, signedBase, nip98: (m, u, b) => signer.nip98(m, u, b), fetchFn: rt.fetchFn, spaceReplays: rt.spaceReplays,
  });
  return { signer, client };
}

module.exports = { runtime, preflight, defaultPublisher };
