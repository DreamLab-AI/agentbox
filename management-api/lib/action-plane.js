'use strict';

/**
 * action-plane — ADR-2041 (WIRE). Builds the real, live ADR-057
 * ExecutionJournal and ADR-059 AgentActionPipeline instances and exposes the
 * one call a route needs to spawn a task through them:
 * `dispatchTaskSpawn()`.
 *
 * Before this module, `execution-journal.js` and `agent-action-pipeline.js`
 * were complete, tested implementations with zero production call sites — the
 * only non-test require was `execution-coverage.js`, which read their static
 * constants and always reported `status: 'declared'` because nothing ever
 * passed it a live instance (GOVERNANCE-capabilities.md "Known divergences #1
 * — TOP OPEN RISK"). This module is the seam that makes them live for the one
 * route this ADR wires: `POST /v1/tasks`.
 *
 * Design:
 *   - Lazy module singleton, built on first call. Construction never throws:
 *     failures are captured as `{ ready:false, reason }` so the caller can
 *     fail closed (PHASE2 remediation policy 1) instead of crashing the
 *     process or silently proceeding unjournalled.
 *   - The events adapter is resolved the same way the rest of management-api
 *     resolves it — `loadManifest()` (adapters/manifest-loader.js) feeding
 *     `resolveAdapters(manifest)` (adapters/index.js) — so an
 *     `adapters.events = "off"` manifest, or no manifest at all, degrades to
 *     the placeholder adapter, which lacks `dispatch()`; `ExecutionJournal`'s
 *     own constructor guard then turns that into a clean `{ready:false}`
 *     rather than a thrown error reaching the route.
 *   - There is NO dev-profile relaxation of the fail-closed rule here: a grep
 *     across agentbox for `AGENTBOX_DEV*` / `dev_profile` / `dev_mode` /
 *     `dev-profile` found no such flag anywhere in this codebase (checked at
 *     ADR-2041 implementation time). Inventing one is out of this module's
 *     scope, so refusal is unconditional until a future ADR introduces one.
 *   - The capability-token secret comes from `AGENTBOX_ACTION_PIPELINE_SECRET`.
 *     When unset, a random per-boot secret is minted and one clear warning is
 *     logged: tokens minted before a management-api restart will not verify
 *     after one (this only affects the ~60s in-flight capability-token
 *     window and D4 parent-token delegation across a restart — it does NOT
 *     affect the journal, which is durable via the events adapter).
 *
 * @see ADR-2041, ADR-057 (execution-journal.js), ADR-059 (agent-action-pipeline.js)
 */

const crypto = require('crypto');
const { loadManifest, ManifestNotFound } = require('../adapters/manifest-loader');
const { resolveAdapters } = require('../adapters/index');
const { ExecutionJournal, JournalError } = require('./execution-journal');
const { AgentActionPipeline, PolicyError } = require('./agent-action-pipeline');
const uris = require('./uris');

// The one (capability, operation) pair this ADR wires. A future ADR that
// wires another route adds its own pair here rather than widening this one's
// meaning — D1 of ADR-059 is one canonical AgentAction shape, not a grab bag.
const TASK_SPAWN_CAPABILITY = 'agentbox.tasks';
const TASK_SPAWN_OPERATION = 'spawn';

// Module singleton. `null` = not yet attempted; otherwise
// `{ ready: boolean, reason: string|null, journal: ExecutionJournal|null, pipeline: AgentActionPipeline|null }`.
let _singleton = null;

// Bound by any getActionPlane() call carrying a processManager (routes/tasks.js
// always supplies one). The pipeline's executor is fixed at construction
// (ADR-059 constructor contract), so it closes over this module binding rather
// than taking processManager per dispatch — the executor reads it at dispatch
// time, so re-binding here never changes the executor's identity. Latching on
// the FIRST manager silently discarded every later one, which sent spawns to a
// stale manager after an adapter-lifecycle re-registration (and made a second
// Fastify app in one process dispatch into the first app's manager).
let _boundProcessManager = null;

function _warnEphemeralSecret(logger) {
  const msg =
    'AGENTBOX_ACTION_PIPELINE_SECRET is not set — using a random per-boot ' +
    'capability-token secret. Tokens minted before a management-api restart ' +
    'will not verify after one (in-flight tokens expire naturally within ' +
    'their tokenTtlMs regardless; this does not affect journal durability).';
  if (logger && typeof logger.warn === 'function') {
    logger.warn({ event: 'action-plane.ephemeral-secret' }, msg);
  } else {
    // eslint-disable-next-line no-console
    console.warn(`[action-plane] ${msg}`);
  }
}

/**
 * Task-spawn classification (ADR-059 stage 3). Honest, not a `read`: spawning
 * an agent task creates a process and durable artifacts (task dir, log file)
 * under the orchestrator's own local supervision. It is classified `local`
 * rather than `mutate` because the mutation is confined to the agent's own
 * task workspace/process — not a write to shared or external state, not
 * network egress, not a secret, not a financial spend (cost is separately
 * gated by `middleware/cost-gate.js`, preserved as this route's preHandler).
 * `local` is in ADR-059's `FAST_PATH`, so the action is still fully
 * journalled but does not additionally require a human/ACSP approval receipt
 * — there is no approver wired here, and none is in this ADR's scope.
 *
 * This is a deliberate, documented interim rollout choice (ADR-059 D5: "one
 * policy; harness projections may be stricter, never weaker" — a future ADR
 * may reclassify task-spawn as `mutate` behind a real approval flow once one
 * exists; see ADR-2041 Consequences).
 */
function _classifyTaskSpawn() {
  return { side_effect_class: 'local', privacy_class: 'internal', estimated_cost: 0 };
}

/**
 * Build (once) the module singleton. Never throws.
 * @param {object} [opts]
 * @param {object} [opts.logger] - pino-style logger for the ephemeral-secret warning
 * @param {object} [opts.processManager] - orchestrator process manager; the
 *   MOST RECENT caller to supply one binds it for subsequent dispatches.
 * @returns {{ready:boolean, reason:string|null, journal:object|null, pipeline:object|null}}
 */
function getActionPlane(opts = {}) {
  if (opts.processManager && opts.processManager !== _boundProcessManager) {
    _boundProcessManager = opts.processManager;
  }
  if (_singleton) return _singleton;
  const logger = opts.logger || null;

  let manifest;
  try {
    manifest = loadManifest();
  } catch (err) {
    if (err instanceof ManifestNotFound) {
      // No manifest → every adapter slot resolves to its 'off'/placeholder
      // impl below, which lacks dispatch(); caught by the ExecutionJournal
      // guard immediately after. Proceed with an empty manifest rather than
      // failing here, so the *reason* reported is the real one (no events
      // adapter), not a manifest-not-found red herring.
      manifest = {};
    } else {
      _singleton = { ready: false, reason: `manifest load failed: ${err.message}`, journal: null, pipeline: null };
      return _singleton;
    }
  }

  let adapters;
  try {
    adapters = resolveAdapters(manifest);
  } catch (err) {
    _singleton = { ready: false, reason: `adapter resolution failed: ${err.message}`, journal: null, pipeline: null };
    return _singleton;
  }

  // Fail-closed (PHASE2 remediation policy 1): ADR-005's "off" events impl
  // deliberately no-ops `dispatch()` — it resolves, has a `dispatch` function,
  // and never throws (adapters/events/off.js), so ExecutionJournal's own
  // constructor guard (`typeof dispatch === 'function'`) is satisfied and
  // would happily build a "journal" that silently drops every event. That is
  // exactly the "proceed unjournalled" failure this ADR exists to close, so
  // it is rejected here explicitly, one level stricter than ExecutionJournal
  // itself checks. `adapters.events = "off"` in agentbox.toml (or no
  // manifest at all, which resolves every slot to 'off') means: refuse.
  const eventsImpl = adapters.events && adapters.events._implName;
  if (!adapters.events || typeof adapters.events.dispatch !== 'function' || eventsImpl === 'off') {
    _singleton = {
      ready: false,
      reason: `events adapter is not live (impl=${eventsImpl || 'none'}) — refusing to spawn a task unjournalled`,
      journal: null,
      pipeline: null,
    };
    return _singleton;
  }

  let journal;
  try {
    journal = new ExecutionJournal({ eventsAdapter: adapters.events });
  } catch (err) {
    if (err instanceof JournalError) {
      _singleton = { ready: false, reason: `journal unavailable: ${err.message}`, journal: null, pipeline: null };
      return _singleton;
    }
    throw err;
  }

  const secret = process.env.AGENTBOX_ACTION_PIPELINE_SECRET || (() => {
    _warnEphemeralSecret(logger);
    return crypto.randomBytes(32).toString('hex');
  })();

  let pipeline;
  try {
    pipeline = new AgentActionPipeline({
      secret,
      journal,
      classifier: _classifyTaskSpawn,
      executor: async (action) => {
        if (!_boundProcessManager) {
          throw new Error('action-plane: no processManager bound (dispatchTaskSpawn was never called with one)');
        }
        const { agent, task, provider, claude_flow_agent_id } = action._args || {};
        return _boundProcessManager.spawnTask(agent, task, provider, claude_flow_agent_id);
      },
    });
  } catch (err) {
    if (err instanceof PolicyError) {
      _singleton = { ready: false, reason: `pipeline unavailable: ${err.message}`, journal, pipeline: null };
      return _singleton;
    }
    throw err;
  }

  _singleton = { ready: true, reason: null, journal, pipeline };
  return _singleton;
}

/**
 * Resolve the acting agent DID for a request, honestly, in priority order:
 *   1. `request.auth.pubkey` — a verified NIP-98 identity (middleware/auth.js)
 *   2. `X-Agentbox-Pubkey` request header — read defensively: another
 *      implementer (ADR-2042) is wiring this into the attribution layer, so
 *      this module does not assume it is present or verified, only that a
 *      64-char lowercase-hex value on it is a usable did:nostr scope.
 *   3. `AGENTBOX_AGENT_DID` — this container's own identity, the honest
 *      fallback when no caller identity is attached to the request.
 *   4. `null` — no identity available; recorded as such rather than guessing.
 * @param {{auth?: {pubkey?: string}, headers?: Record<string,string>}} [request]
 * @returns {string|null}
 */
function resolveAgentDid(request) {
  const req = request || {};
  const verifiedPubkey = req.auth && typeof req.auth.pubkey === 'string' ? req.auth.pubkey : null;
  if (verifiedPubkey && /^[0-9a-f]{64}$/.test(verifiedPubkey)) {
    return `did:nostr:${verifiedPubkey}`;
  }
  const headerPubkey = req.headers && (req.headers['x-agentbox-pubkey'] || req.headers['X-Agentbox-Pubkey']);
  if (typeof headerPubkey === 'string' && /^[0-9a-f]{64}$/i.test(headerPubkey)) {
    return `did:nostr:${headerPubkey.toLowerCase()}`;
  }
  return process.env.AGENTBOX_AGENT_DID || null;
}

/**
 * Dispatch a task-spawn action through the ADR-059 pipeline. The pipeline's
 * executor performs the actual `processManager.spawnTask(...)` call, inside
 * the protected executor seam (ADR-059 stage 6) — so the spawn only happens
 * after classify/guard have run and a capability token has been minted for
 * exactly this action, not before.
 *
 * @param {object} params
 * @param {string} params.agent
 * @param {string} params.task
 * @param {string} params.provider
 * @param {string|null} params.claude_flow_agent_id
 * @param {object} [params.request] - the Fastify request, for identity resolution
 * @param {object} deps
 * @param {object} deps.processManager
 * @param {object} [deps.logger]
 * @returns {Promise<{ready:boolean, reason?:string, decision?:string, output?:object, denyReason?:string}>}
 */
async function dispatchTaskSpawn(params, deps) {
  const plane = getActionPlane({ logger: deps.logger, processManager: deps.processManager });
  if (!plane.ready) {
    return { ready: false, reason: plane.reason };
  }

  const sessionUrn = uris.mint({ kind: 'meta', localId: `session-task-${crypto.randomUUID()}` });
  const agentDid = resolveAgentDid(params.request);

  const result = await plane.pipeline.dispatch({
    session_urn: sessionUrn,
    agent_did: agentDid,
    harness: 'management-api',
    capability: TASK_SPAWN_CAPABILITY,
    operation: TASK_SPAWN_OPERATION,
    args: {
      agent: params.agent,
      task: params.task,
      provider: params.provider,
      claude_flow_agent_id: params.claude_flow_agent_id,
    },
    target: params.agent,
  });

  // The pipeline's contract (tests/contract/agent-action-pipeline.contract.spec.js)
  // is `decision: 'deny'`; this layer normalises it to `'denied'` for the route.
  // Comparing against 'denied' here let a denial fall through to the allow
  // branch and throw outside the route's try/catch (500 where 403 was meant).
  if (result.decision === 'deny') {
    return { ready: true, decision: 'denied', denyReason: result.reason, journalEventId: result.journal_event_id };
  }
  return { ready: true, decision: 'allow', output: result.output, journalEventId: result.journal_event_id };
}

/**
 * Coverage snapshot for `execution-coverage.js` (`/v1/system`). Returns the
 * SAME live singletons `dispatchTaskSpawn` uses, so `status: 'live'` there
 * means exactly what it says — never inferred, never a second, unrelated
 * instance. Returns `{}` when the plane has never been (successfully) built
 * (matches `execution-coverage.js`'s existing "no live instance" contract).
 */
function getCoverageSnapshot() {
  if (!_singleton || !_singleton.ready) return {};
  return {
    journal: _singleton.journal.coverage(),
    pipeline: _singleton.pipeline.coverage(),
  };
}

module.exports = {
  getActionPlane,
  dispatchTaskSpawn,
  resolveAgentDid,
  getCoverageSnapshot,
  TASK_SPAWN_CAPABILITY,
  TASK_SPAWN_OPERATION,
};
