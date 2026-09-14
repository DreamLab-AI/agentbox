'use strict';

/**
 * lib/governance-receipt-publisher — mirror the mutation owner's application
 * receipts to the forum (PRD-augmentation-conditions FR4.2 / FR7.1, ADR-2087).
 *
 * THE GAP THIS CLOSES. agentbox is the mutation owner: after a human approves a
 * zero-tolerance action, agentbox is the ONLY party that knows whether the
 * mutation actually landed. `ApplicationReceiptStore` already records that
 * locally, durably and write-once. But the human who signed the approval had no
 * way to learn the outcome — the decision chain in the forum stopped at
 * `projection-committed`, which says only "the relay stored your decision", not
 * "your decision took effect". Augmentation condition C3 (accountability and
 * recovery) fails on exactly that gap, and C2 with it: a reviewer who never
 * learns the consequence of an approval cannot calibrate the next one.
 *
 * THE LADDER. `signed → relay-accepted → projection-committed` are the forum's
 * stages. The four this module publishes are the mutation owner's:
 *
 *     consumer-received   the approval reached the actor that will act on it
 *     applied             the mutation committed
 *     not-applied         the mutation did not commit (and will not)
 *     applied-manually    an operator executed it by hand during an outage
 *
 * WHAT IS RETRIED AND WHAT IS NOT. A post can fail for two very different
 * reasons, and conflating them is how receipts get lost or duplicated:
 *
 *   * TRANSPORT failure (network, 5xx, no signer, no configured endpoint) — the
 *     receipt is still TRUE; only its delivery failed. It is written to a
 *     durable queue and replayed by `flush()`. Replay is safe because the
 *     mutation already happened: this re-sends a RECORD, never a mutation.
 *   * SEMANTIC refusal (409 stage regression, 403 not authorised) — the forum
 *     has considered this receipt and refused it. Retrying cannot change the
 *     answer, so the entry is retired rather than queued, and the refusal is
 *     journalled so it is visible instead of quietly absorbed.
 *
 * Either way the failure is written to the hash-chained journal as
 * `authority.receipt-post-failed`. Nothing here fails silently, and nothing is
 * deleted un-posted: an exhausted entry is kept on disk marked `failed`,
 * because a stale receipt an operator can find beats a lost one they cannot.
 *
 * @see lib/governance-application-receipts.js (the local write-once record)
 * @see lib/authority-journal.js               (where failures are recorded)
 * @see routes/broker-bridge.js                (the caller: begin/finish)
 * @see mcp/servers/governance-bridge.js       (manual continuation)
 * @see EXP-AC-004, EXP-AC-007, ADR-2087
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { RECEIPT_POST_FAILED_KIND } = require('./authority-journal');

/** The mutation-owner stages, in ladder order. */
const APPLICATION_STAGES = Object.freeze([
  'consumer-received', 'applied', 'not-applied', 'applied-manually',
]);

/** Default replay budget before an entry is parked as `failed` (kept, not dropped). */
const DEFAULT_MAX_ATTEMPTS = 8;

/** Default replay cadence when `start()` is used. */
const DEFAULT_FLUSH_INTERVAL_MS = 60_000;

const NOOP_LOGGER = { debug() {}, info() {}, warn() {}, error() {} };

/** Where queued receipts live when the caller names no directory. */
function defaultOutboxDir() {
  const stateDir = process.env.AGENTBOX_STATE_DIR
    || path.join(os.homedir(), '.local/state/agentbox');
  return path.join(stateDir, 'governance-receipt-outbox');
}

/**
 * Resolve the forum auth-API base. Env wins over the manifest so an operator can
 * repoint a running container without a manifest edit (the same precedence the
 * relay URL uses). Returns null when neither is set — an explicit "not
 * configured", never a guessed localhost.
 */
function resolveBaseUrl(manifest, env) {
  const fromEnv = env && typeof env.FORUM_AUTH_API === 'string' ? env.FORUM_AUTH_API.trim() : '';
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  const fromManifest = manifest && manifest.sovereign_mesh && manifest.sovereign_mesh.relay
    && manifest.sovereign_mesh.relay.forum_auth_api;
  if (typeof fromManifest === 'string' && fromManifest.trim()) {
    return fromManifest.trim().replace(/\/+$/, '');
  }
  return null;
}

/**
 * The production NIP-98 originator: sign as the agent's own `did:nostr`, using
 * the same lazily-loaded signer the rest of the sovereign mesh uses. Returns a
 * function that resolves to `null` when no key material is reachable — the
 * publisher then queues rather than posting unsigned (lib/pod-signer's posture).
 *
 * @param {object} [deps]
 * @param {object} [deps.env]
 * @param {object} [deps.logger]
 * @returns {(method: string, url: string, body: string) => Promise<string|null>}
 */
function buildDefaultNip98(deps = {}) {
  const env = deps.env || process.env;
  const logger = deps.logger || NOOP_LOGGER;
  const stack = env.AGENTBOX_STACK || env.AGENTBOX_PROFILE || null;
  let bridge = null;
  let signer = null;
  let loadFailed = false;

  const getBridge = () => {
    if (bridge) return bridge;
    // Vendored into lib/ at build time; the sibling mcp/ path only resolves
    // from the source checkout (same dual lookup as lib/pod-signer.js).
    try { bridge = require('./nostr-bridge'); }
    catch { bridge = require('../../mcp/servers/nostr-bridge'); }
    return bridge;
  };

  return async function nip98(method, url, body) {
    if (loadFailed) return null;
    if (!signer) {
      try { signer = getBridge().loadSigner(stack, {}); }
      catch (err) {
        loadFailed = true;
        logger.warn({ event: 'governance.receipt-signer-unavailable', err: err.message },
          'no NIP-98 signer for forum receipts — receipts will queue until one is available');
        return null;
      }
    }
    return getBridge().NostrBridge.buildNip98Header(signer, method, url, { body });
  };
}

/**
 * Build the receipt publisher.
 *
 * @param {object} [deps]
 * @param {object}   [deps.manifest] - parsed agentbox.toml (supplies forum_auth_api)
 * @param {object}   [deps.env=process.env]
 * @param {string}   [deps.outboxDir] - durable retry queue directory
 * @param {Function} [deps.fetchImpl=globalThis.fetch]
 * @param {Function} [deps.nip98] - `(method, url, body) => Promise<string|null>`;
 *   a null token means "could not sign" and the receipt is queued rather than
 *   posted unsigned at a default-deny endpoint (same posture as lib/pod-signer).
 * @param {{append: Function}} [deps.journal] - the authority journal
 * @param {object}   [deps.logger]
 * @param {string}   [deps.agentDid]
 * @param {number}   [deps.maxAttempts=8]
 * @param {() => number} [deps.now]
 * @returns {{post: Function, flush: Function, start: Function, stop: Function,
 *            outboxDir: string, baseUrl: string|null}}
 */
function buildReceiptPublisher(deps = {}) {
  const env = deps.env || process.env;
  const manifest = deps.manifest || null;
  const logger = deps.logger || NOOP_LOGGER;
  const journal = (deps.journal && typeof deps.journal.append === 'function') ? deps.journal : null;
  const outboxDir = deps.outboxDir || defaultOutboxDir();
  const fetchImpl = deps.fetchImpl || (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
  const nip98 = deps.nip98 !== undefined
    ? (typeof deps.nip98 === 'function' ? deps.nip98 : null)
    : buildDefaultNip98({ env, logger });
  const maxAttempts = Number.isFinite(deps.maxAttempts) && deps.maxAttempts > 0
    ? deps.maxAttempts : DEFAULT_MAX_ATTEMPTS;
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now();
  const baseUrl = resolveBaseUrl(manifest, env);
  const agentDid = deps.agentDid || (env.AGENTBOX_PUBKEY ? `did:nostr:${env.AGENTBOX_PUBKEY}` : null);

  let timer = null;

  function endpointFor(responseEventId) {
    return `${baseUrl}/api/governance/receipts/${encodeURIComponent(responseEventId)}/application`;
  }

  /** Validate and normalise one receipt into exactly the documented body. */
  function normalise(receipt) {
    const r = receipt || {};
    if (typeof r.response_event_id !== 'string' || !/^[0-9a-f]{64}$/i.test(r.response_event_id)) {
      throw new TypeError('receipt requires a 64-char hex response_event_id');
    }
    if (!APPLICATION_STAGES.includes(r.stage)) {
      throw new TypeError(`receipt stage must be one of ${APPLICATION_STAGES.join(' | ')}`);
    }
    const body = { stage: r.stage };
    if (r.acknowledgement !== undefined && r.acknowledgement !== null) body.acknowledgement = r.acknowledgement;
    if (r.executed_by) body.executed_by = r.executed_by;
    if (r.evidence) body.evidence = r.evidence;
    return { response_event_id: r.response_event_id.toLowerCase(), stage: r.stage, body };
  }

  /** Record a post failure on the hash-chained journal. Never throws. */
  async function journalFailure(normalised, error, extra = {}) {
    if (!journal) return;
    try {
      await journal.append({
        type: RECEIPT_POST_FAILED_KIND,
        agent_did: agentDid,
        stage: normalised.stage,
        reason: error,
        response_event_id: normalised.response_event_id,
        ...extra,
      });
    } catch (err) {
      logger.error({ event: 'authority.receipt-post-failed.unjournalled', err: err.message },
        'receipt post failure could not be journalled');
    }
  }

  /** A stable filename per (response_event_id, stage) so a replay never forks. */
  function entryPath(normalised) {
    const key = createHash('sha256')
      .update(`${normalised.response_event_id}:${normalised.stage}`).digest('hex').slice(0, 32);
    return path.join(outboxDir, `${key}.json`);
  }

  function writeEntry(file, entry) {
    fs.mkdirSync(outboxDir, { recursive: true, mode: 0o700 });
    const tmp = path.join(outboxDir, `.${randomUUID()}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(entry, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  /** Queue a receipt whose delivery (not truth) failed. */
  function enqueue(normalised, error) {
    const file = entryPath(normalised);
    let prior = null;
    try { prior = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first attempt */ }
    const attempts = (prior && Array.isArray(prior.attempts) ? prior.attempts : [])
      .concat({ at: new Date(now()).toISOString(), error });
    const exhausted = attempts.length >= maxAttempts;
    const entry = {
      schema_version: 1,
      receipt: { response_event_id: normalised.response_event_id, stage: normalised.stage, body: normalised.body },
      status: exhausted ? 'failed' : 'pending',
      queued_at: (prior && prior.queued_at) || new Date(now()).toISOString(),
      attempts,
    };
    writeEntry(file, entry);
    return { file, exhausted, attempts: attempts.length };
  }

  /**
   * Attempt one POST. Returns a classified outcome; never throws on transport.
   * @returns {Promise<{ok: boolean, status?: number, error?: string, terminal?: boolean,
   *                    regression?: boolean, unauthorised?: boolean}>}
   */
  async function attempt(normalised) {
    if (!baseUrl) {
      return { ok: false, error: 'forum auth API is not configured (set FORUM_AUTH_API or sovereign_mesh.relay.forum_auth_api)' };
    }
    if (!fetchImpl) return { ok: false, error: 'no fetch implementation available' };

    const url = endpointFor(normalised.response_event_id);
    const body = JSON.stringify(normalised.body);

    let token = null;
    if (nip98) {
      try { token = await nip98('POST', url, body); }
      catch (err) { return { ok: false, error: `NIP-98 signing failed: ${err.message}` }; }
    }
    // The endpoint is NIP-98-authenticated. Posting unsigned would be refused
    // anyway; queueing keeps the receipt for when the signer is available again.
    if (!token) return { ok: false, error: 'NIP-98 token unavailable — receipt not posted unsigned' };

    let response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: token },
        body,
      });
    } catch (err) {
      return { ok: false, error: `receipt POST failed: ${err.message}` };
    }

    if (response.ok) return { ok: true, status: response.status };

    let detail = '';
    try { detail = (await response.text() || '').slice(0, 512); } catch { /* body optional */ }

    // 409 — the forum holds a stage at or past this one. The ladder is
    // monotonic by design; re-posting can only be refused again.
    if (response.status === 409) {
      return { ok: false, status: response.status, terminal: true, regression: true,
        error: `receipt refused as a stage regression (409): ${detail}` };
    }
    // 403 — not authorised for this stage (e.g. `applied-manually` without an
    // admin key). A retry with the same identity cannot succeed.
    if (response.status === 403) {
      return { ok: false, status: response.status, terminal: true, unauthorised: true,
        error: `receipt refused as unauthorised (403): ${detail}` };
    }
    // Any other 4xx is a request the forum will keep refusing; only 5xx and
    // transport errors are worth replaying.
    const terminal = response.status >= 400 && response.status < 500;
    return { ok: false, status: response.status, terminal,
      error: `receipt POST returned ${response.status}: ${detail}` };
  }

  /**
   * Publish one receipt stage, queueing it if delivery fails.
   *
   * @param {object} receipt
   * @param {string} receipt.response_event_id - the signed 31403 this receipt binds to
   * @param {string} receipt.stage
   * @param {object} [receipt.acknowledgement]
   * @param {string} [receipt.executed_by]  - `applied-manually` only: the human DID
   * @param {string} [receipt.evidence]     - `applied-manually` only
   * @returns {Promise<{ok: boolean, queued: boolean, status?: number, error?: string}>}
   */
  async function post(receipt) {
    const normalised = normalise(receipt);
    const outcome = await attempt(normalised);

    if (outcome.ok) {
      // A successful post supersedes anything queued for the same stage.
      try { fs.unlinkSync(entryPath(normalised)); } catch { /* nothing queued */ }
      logger.debug({ event: 'governance.receipt-posted', stage: normalised.stage,
        response_event_id: normalised.response_event_id, status: outcome.status },
        'application receipt mirrored to the forum');
      return { ok: true, queued: false, status: outcome.status };
    }

    await journalFailure(normalised, outcome.error, {
      status: outcome.status || null,
      terminal: !!outcome.terminal,
    });

    if (outcome.terminal) {
      logger.warn({ event: 'governance.receipt-refused', stage: normalised.stage,
        response_event_id: normalised.response_event_id, status: outcome.status, error: outcome.error },
        'application receipt refused by the forum — not queued (a retry cannot change the answer)');
      return {
        ok: false, queued: false, status: outcome.status, error: outcome.error,
        ...(outcome.regression ? { regression: true } : {}),
        ...(outcome.unauthorised ? { unauthorised: true } : {}),
      };
    }

    const queued = enqueue(normalised, outcome.error);
    logger.warn({ event: 'governance.receipt-queued', stage: normalised.stage,
      response_event_id: normalised.response_event_id, attempts: queued.attempts, error: outcome.error },
      'application receipt could not be posted — queued for retry');
    return { ok: false, queued: true, status: outcome.status, error: outcome.error, exhausted: queued.exhausted };
  }

  /**
   * Replay every queued receipt once.
   *
   * @returns {Promise<{attempted: number, posted: number, retired: number,
   *                    exhausted: number, remaining: number}>}
   */
  async function flush() {
    const summary = { attempted: 0, posted: 0, retired: 0, exhausted: 0, remaining: 0 };
    let files;
    try { files = fs.readdirSync(outboxDir).filter((f) => f.endsWith('.json')); }
    catch { return summary; } // no queue yet — nothing to replay

    for (const file of files) {
      const full = path.join(outboxDir, file);
      let entry;
      try { entry = JSON.parse(fs.readFileSync(full, 'utf8')); }
      catch (err) {
        logger.warn({ event: 'governance.receipt-queue-unparseable', file, err: err.message },
          'queued receipt could not be parsed — left in place for an operator');
        continue;
      }
      if (entry.status === 'failed') { summary.exhausted += 1; continue; }

      let normalised;
      try { normalised = normalise(entry.receipt); }
      catch (err) {
        logger.warn({ event: 'governance.receipt-queue-invalid', file, err: err.message },
          'queued receipt is not a valid receipt — left in place for an operator');
        continue;
      }
      // Preserve any extra body fields (executed_by, evidence, acknowledgement)
      // exactly as queued rather than re-deriving them.
      if (entry.receipt && entry.receipt.body) normalised.body = entry.receipt.body;

      summary.attempted += 1;
      const outcome = await attempt(normalised);
      if (outcome.ok) {
        try { fs.unlinkSync(full); } catch { /* already gone */ }
        summary.posted += 1;
        continue;
      }
      await journalFailure(normalised, outcome.error, { status: outcome.status || null, replay: true });
      if (outcome.terminal) {
        // The forum has answered definitively; the queue entry has no future.
        try { fs.unlinkSync(full); } catch { /* already gone */ }
        summary.retired += 1;
        continue;
      }
      const queued = enqueue(normalised, outcome.error);
      if (queued.exhausted) summary.exhausted += 1;
      else summary.remaining += 1;
    }
    return summary;
  }

  /** Start periodic replay. Idempotent; the timer never keeps the process alive. */
  function start({ intervalMs = DEFAULT_FLUSH_INTERVAL_MS } = {}) {
    if (timer) return timer;
    timer = setInterval(() => {
      flush().catch((err) => logger.error({ err: err.message }, 'receipt outbox flush failed'));
    }, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
    return timer;
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { post, flush, start, stop, outboxDir, baseUrl, APPLICATION_STAGES };
}

module.exports = {
  buildReceiptPublisher,
  buildDefaultNip98,
  APPLICATION_STAGES,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_FLUSH_INTERVAL_MS,
  defaultOutboxDir,
  resolveBaseUrl,
};
