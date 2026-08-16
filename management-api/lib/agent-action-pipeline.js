'use strict';

/**
 * agent-action-pipeline — ADR-059, the single monotonic policy pipeline every
 * agent-initiated side effect crosses. It normalises heterogeneous actions
 * (tool, MCP, shell, filesystem mutation, code-dispatched sub-call, consultant
 * call, job, spend) into one canonical `AgentAction`, runs them through a fixed,
 * observable nine-stage order, and records one immutable outcome linked to the
 * ADR-057 journal.
 *
 * The invariant is not the tool registry; it is that later stages cannot weaken
 * an earlier denial or change the approved action's identity, and that nested
 * actions cannot bypass policy.
 *
 *   D1  canonical AgentAction for every model-initiated side effect
 *   D2  fixed stage order; after approval the action identity + cost ceiling freeze
 *   D3  guards are monotonic and fail closed; mutation/egress/secret/spend never fail open
 *   D4  nested actions carry a scoped parent token; child authority = delegated ∩ owner policy
 *   D5  one policy; harness projections may be stricter, never weaker
 *
 * @see ADR-059 §Decision
 * @see docs/reference/adr/ADR-059-monotonic-agent-action-policy-pipeline.md
 */

const crypto = require('crypto');

const STAGES = Object.freeze([
  'normalise', 'enrich', 'classify', 'approve', 'guard',
  'execute', 'post-process', 'finalise', 'record',
]);

const SIDE_EFFECT_CLASSES = Object.freeze(['read', 'local', 'mutate', 'egress', 'secret', 'spend']);
// Classes that require a one-use approval decision unless owner policy says otherwise.
const APPROVAL_REQUIRED = new Set(['mutate', 'egress', 'secret', 'spend']);
// Classes whose authoritative outcome must never be produced by a fail-open path.
const NEVER_FAIL_OPEN = new Set(['mutate', 'egress', 'secret', 'spend']);
// Low-risk classes eligible for the approval-free fast path (still journalled).
const FAST_PATH = new Set(['read', 'local']);

class PolicyError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'PolicyError';
    this.code = code || 'policy_error';
  }
}

/** A pipeline denial. Carries the stage and reason for the audit record. */
class ActionDenied extends PolicyError {
  constructor(reason, stage, code) {
    super(`action denied at ${stage}: ${reason}`, code || 'denied');
    this.name = 'ActionDenied';
    this.stage = stage;
    this.reason = reason;
  }
}

class AgentActionPipeline {
  /**
   * @param {object} opts
   * @param {string} opts.secret                  - HMAC secret for capability tokens
   * @param {Array<{id:string, guard:Function}>} [opts.guards] - monotonic guards → 'deny'|'abstain'
   * @param {(action:object)=>object|Promise<object>} [opts.approver] - yields an approval receipt
   * @param {(action:object)=>object|Promise<object>} [opts.classifier] - assigns side_effect/privacy/cost
   * @param {(action:object)=>any|Promise<any>} opts.executor - the shared protected executor
   * @param {{append:Function}} [opts.journal]     - ADR-057 ExecutionJournal for the record stage
   * @param {(output:any, action:object)=>any} [opts.postProcess] - untrusted-output redaction
   * @param {(action:object, output:any)=>void} [opts.finalise]   - definition-owned sync invariants
   * @param {() => number} [opts.now]              - epoch-ms clock override (tests)
   * @param {number} [opts.tokenTtlMs=60000]
   */
  constructor(opts = {}) {
    if (!opts.secret) throw new PolicyError('a token secret is required', 'no_secret');
    if (typeof opts.executor !== 'function') throw new PolicyError('an executor is required', 'no_executor');
    this._secret = opts.secret;
    this._guards = (opts.guards || []).map((g) => ({ id: g.id || 'guard', guard: g.guard }));
    this._approver = opts.approver || null;
    this._classifier = opts.classifier || (() => ({ side_effect_class: 'read', privacy_class: 'internal', estimated_cost: 0 }));
    this._executor = opts.executor;
    this._postProcess = opts.postProcess || ((output) => output);
    this._finalise = opts.finalise || (() => {});
    this._journal = opts.journal || null;
    this._now = typeof opts.now === 'function' ? opts.now : () => Date.now();
    this._tokenTtlMs = opts.tokenTtlMs || 60000;
    // Owner-policy bound on what a ROOT action may delegate to nested children
    // (D4). Default '*' — owner policy governs the action itself via guards; a
    // deployment narrows this to cap the authority any composite tool can pass on.
    this._rootAuthority = opts.rootAuthority || { side_effect_classes: '*' };
    this._usedNonces = new Set();   // single-use approval receipts
    this._dispatchSeq = 0;          // uniqueness salt for action_id
  }

  /**
   * Dispatch one action through the pipeline.
   *
   * @param {object} raw
   * @param {string} raw.session_urn
   * @param {string} raw.agent_did
   * @param {string} raw.harness
   * @param {string} raw.capability
   * @param {string} raw.operation
   * @param {*} [raw.args]
   * @param {string} [raw.target]
   * @param {number} [raw.deadline]  - epoch-ms
   * @param {object} [opts]
   * @param {object} [opts.parentToken] - token minted by an enclosing action (D4)
   * @param {object} [opts.approval]    - a one-use approval receipt
   * @returns {Promise<{decision:string, action:object, output?:any, reason?:string, journal_event_id?:string, token?:object}>}
   */
  async dispatch(raw, opts = {}) {
    let action;
    try {
      // 1 — normalise: canonical identity + delegated authority.
      action = this._normalise(raw, opts.parentToken);

      // 2 — enrich: trusted context only; operation + target are frozen here.
      const frozenCore = _coreIdentity(action);
      this._enrich(action);
      if (_coreIdentity(action) !== frozenCore) {
        throw new ActionDenied('enrich changed operation/target', 'enrich', 'enrich_mutated_identity');
      }

      // 3 — classify: side effects, privacy, destination, estimated cost.
      const c = await this._classifier(action);
      action.side_effect_class = SIDE_EFFECT_CLASSES.includes(c.side_effect_class) ? c.side_effect_class : 'mutate';
      action.privacy_class = c.privacy_class || 'internal';
      action.estimated_cost = Number(c.estimated_cost) || 0;

      // D4 — a child can never exceed its parent's delegated authority.
      if (action._delegatedAuthority && !_authorityAllows(action._delegatedAuthority, action.side_effect_class)) {
        throw new ActionDenied(
          `child side_effect_class '${action.side_effect_class}' exceeds delegated authority`,
          'guard', 'authority_exceeded',
        );
      }

      // 4 — approve: one-use decision when required. Identity + cost ceiling freeze here.
      const identityHash = _identityHash(action);
      const needsApproval = APPROVAL_REQUIRED.has(action.side_effect_class) && !FAST_PATH.has(action.side_effect_class);
      if (needsApproval) {
        const receipt = await this._obtainApproval(action, opts.approval);
        this._validateReceipt(receipt, action, identityHash); // throws ActionDenied on any failure
        action._approvedIdentityHash = identityHash;
        action._costCeiling = receipt.cost_ceiling;
      }

      // 5 — guard: monotonic, fail closed. Any deny wins; a throwing guard denies.
      for (const g of this._guards) {
        let verdict;
        try {
          verdict = await g.guard(action);
        } catch (err) {
          throw new ActionDenied(`guard '${g.id}' errored: ${err.message}`, 'guard', 'guard_error');
        }
        if (verdict === 'deny') throw new ActionDenied(`guard '${g.id}' denied`, 'guard', 'guard_denied');
        if (verdict !== 'abstain') {
          throw new ActionDenied(`guard '${g.id}' returned non-monotonic verdict '${verdict}'`, 'guard', 'bad_verdict');
        }
      }

      // D2 — re-verify the approved identity did not change after approval began.
      if (action._approvedIdentityHash && action._approvedIdentityHash !== _identityHash(action)) {
        throw new ActionDenied('action identity changed after approval', 'guard', 'mutation_after_approval');
      }

      // 6 — execute: through the protected executor seam with a scoped token.
      const token = this._mintToken(action);
      const rawOutput = await this._protectedExecute(action, token);

      // 7 — post-process untrusted output. Fail-open is permitted ONLY for
      // low-risk presentation; secret/sensitive output fails closed on redaction
      // failure so a redaction bug can never disclose (D3).
      let output;
      let outputDegraded = false;
      try {
        output = await this._postProcess(rawOutput, action);
      } catch (err) {
        if (NEVER_FAIL_OPEN.has(action.side_effect_class) || _isSensitive(action.privacy_class)) {
          throw new ActionDenied(`post-process failed for protected output: ${err.message}`, 'post-process', 'redaction_failed');
        }
        output = { redaction_failed: true }; // fail-open for public/internal presentation only
        outputDegraded = true;
      }

      // 8 — finalise: definition-owned synchronous invariants.
      await this._finalise(action, output);

      // 9 — record one immutable outcome linked to the journal.
      const journalId = await this._record(action, { decision: 'allow', ok: true, degraded: outputDegraded });
      return { decision: 'allow', action: _publicAction(action), output, journal_event_id: journalId, token };
    } catch (err) {
      if (err instanceof ActionDenied) {
        const journalId = await this._record(action, { decision: 'deny', ok: false, stage: err.stage, reason: err.reason });
        return { decision: 'deny', action: action ? _publicAction(action) : null, reason: err.reason, stage: err.stage, journal_event_id: journalId };
      }
      throw err; // non-policy failures propagate
    }
  }

  // ── stage 1 ────────────────────────────────────────────────────────────────
  _normalise(raw, parentToken) {
    const r = raw || {};
    if (!r.session_urn) throw new ActionDenied('session_urn is required', 'normalise', 'bad_action');
    if (!r.capability || !r.operation) throw new ActionDenied('capability and operation are required', 'normalise', 'bad_action');

    const canonicalArgsHash = _hash(_stableStringify(r.args === undefined ? null : r.args));
    const action = {
      action_id: null,
      parent_action_id: null,
      session_urn: r.session_urn,
      agent_did: r.agent_did || null,
      harness: r.harness || 'unknown',
      capability: r.capability,
      operation: r.operation,
      canonical_args_hash: canonicalArgsHash,
      target: r.target || null,
      side_effect_class: null,
      privacy_class: null,
      estimated_cost: undefined,
      deadline: r.deadline || (this._now() + 30000),
      provenance: r.provenance || {},
      _args: r.args,
      _delegatedAuthority: null,
    };

    if (parentToken) {
      const parent = this._verifyToken(parentToken); // throws ActionDenied if forged/expired
      action.parent_action_id = parent.action_id;
      action.provenance = { ...action.provenance, causation: parent.action_id };
      action._delegatedAuthority = parent.authority; // intersected against owner policy at classify/guard
    }

    action.action_id = _hash(`${_coreIdentity(action)}|${this._dispatchSeq++}`);
    return action;
  }

  // ── stage 2 ────────────────────────────────────────────────────────────────
  _enrich(action) {
    // Trusted context only. Must not change operation or target (asserted by caller).
    action.provenance = { ...action.provenance, enriched_at: this._now() };
  }

  // ── stage 4 helpers ─────────────────────────────────────────────────────────
  async _obtainApproval(action, supplied) {
    if (supplied) return supplied;
    if (this._approver) return this._approver(action);
    throw new ActionDenied('approval required but no receipt supplied and no approver configured', 'approve', 'approval_missing');
  }

  _validateReceipt(receipt, action, identityHash) {
    if (!receipt || typeof receipt !== 'object') {
      throw new ActionDenied('approval receipt missing', 'approve', 'approval_missing');
    }
    if (!receipt.nonce) throw new ActionDenied('approval receipt has no nonce', 'approve', 'approval_malformed');
    if (this._usedNonces.has(receipt.nonce)) {
      throw new ActionDenied('approval receipt nonce already used (replay)', 'approve', 'approval_replayed');
    }
    const expiry = Date.parse(receipt.expiry);
    if (!Number.isFinite(expiry) || expiry <= this._now()) {
      throw new ActionDenied('approval receipt expired or missing expiry', 'approve', 'approval_expired');
    }
    if (receipt.action_identity_hash !== identityHash) {
      throw new ActionDenied('approval receipt does not match the action identity', 'approve', 'approval_mismatch');
    }
    if (receipt.actor_did && action.agent_did && receipt.actor_did !== action.agent_did) {
      throw new ActionDenied('approval receipt actor DID mismatch', 'approve', 'approval_actor_mismatch');
    }
    const ceiling = Number(receipt.cost_ceiling);
    if (Number.isFinite(ceiling) && action.estimated_cost > ceiling) {
      throw new ActionDenied('estimated cost exceeds approved ceiling', 'approve', 'cost_exceeds_ceiling');
    }
    this._usedNonces.add(receipt.nonce); // single-use — consumed on first valid use
  }

  // ── stage 6 ────────────────────────────────────────────────────────────────
  /**
   * The protected executor seam (D4). A direct call without a valid, matching
   * capability token is rejected here, not merely by convention in a wrapper.
   * Enforces the action deadline as a timeout.
   */
  async _protectedExecute(action, token) {
    if (!this._verifyTokenCovers(token, action)) {
      throw new ActionDenied('missing or invalid capability token at executor seam', 'execute', 'no_capability_token');
    }
    const timeoutMs = Math.max(1, action.deadline - this._now());
    let timer;
    try {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new ActionDenied('execution deadline exceeded', 'execute', 'timeout')), timeoutMs);
        if (timer.unref) timer.unref();
      });
      return await Promise.race([Promise.resolve().then(() => this._executor(action, token)), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  // ── stage 9 ────────────────────────────────────────────────────────────────
  async _record(action, outcome) {
    if (!this._journal || !action) return null;
    try {
      const { envelope } = await this._journal.append({
        session_urn: action.session_urn,
        type: 'tool.completed',
        harness: action.harness,
        agent_did: action.agent_did,
        turn: Number.isInteger(action.provenance && action.provenance.turn) ? action.provenance.turn : 0,
        privacy_class: _isSensitive(action.privacy_class) ? 'sensitive' : 'internal',
        payload: {
          capability: action.capability,
          operation: action.operation,
          action_id: action.action_id,
          parent_action_id: action.parent_action_id,
          side_effect_class: action.side_effect_class,
          canonical_args_hash: action.canonical_args_hash,
          ...outcome,
        },
      });
      return envelope.event_id;
    } catch (_) {
      return null; // recording failure must not manufacture a different decision
    }
  }

  // ── capability tokens (D4) ───────────────────────────────────────────────────
  _mintToken(action) {
    // The token's authority is the set of side-effect classes this action may
    // DELEGATE to nested children — never what the action itself may do (that is
    // already decided by approval + guards). A root action delegates within owner
    // policy; a child narrows to the intersection of its parent's authority and
    // its own class, so authority can only shrink down the causation chain.
    const authority = action._delegatedAuthority
      ? _intersectAuthority(action._delegatedAuthority, action.side_effect_class)
      : this._rootAuthority;
    const body = {
      token_id: _hash(`${action.action_id}|token`),
      action_id: action.action_id,
      capability: action.capability,
      side_effect_class: action.side_effect_class,
      authority,
      expiry: this._now() + this._tokenTtlMs,
    };
    body.sig = this._sign(body);
    return body;
  }

  _verifyToken(token) {
    if (!token || typeof token !== 'object' || !token.sig) {
      throw new ActionDenied('capability token missing or unsigned', 'normalise', 'token_unsigned');
    }
    const { sig, ...body } = token;
    if (this._sign(body) !== sig) {
      throw new ActionDenied('capability token signature invalid (forged)', 'normalise', 'token_forged');
    }
    if (typeof token.expiry !== 'number' || token.expiry <= this._now()) {
      throw new ActionDenied('capability token expired', 'normalise', 'token_expired');
    }
    return token;
  }

  /**
   * True when the token is valid and was minted for exactly this action. This is
   * the executor-seam gate (D4): a protected executor invoked with no token, a
   * forged token, or a token minted for a different action is rejected.
   */
  _verifyTokenCovers(token, action) {
    try {
      const t = this._verifyToken(token);
      return t.action_id === action.action_id;
    } catch (_) {
      return false;
    }
  }

  _sign(body) {
    return crypto.createHmac('sha256', this._secret).update(_stableStringify(body)).digest('hex');
  }

  /** Diagnostics for /v1/system: stage order + policy classes (ADR-059 §D5). */
  coverage() {
    return {
      stages: STAGES.slice(),
      side_effect_classes: SIDE_EFFECT_CLASSES.slice(),
      approval_required: Array.from(APPROVAL_REQUIRED),
      never_fail_open: Array.from(NEVER_FAIL_OPEN),
      guards: this._guards.map((g) => g.id),
    };
  }
}

// ── pure helpers ───────────────────────────────────────────────────────────────

/** Operation + target, the part enrich must not mutate. */
function _coreIdentity(action) {
  return `${action.capability} ${action.operation} ${action.target || ''}`;
}

/** The frozen identity an approval binds: capability+operation+target+args hash. */
function _identityHash(action) {
  return _hash(`${_coreIdentity(action)} ${action.canonical_args_hash}`);
}

/** authority.side_effect_classes is '*' or an array; does it permit this class? */
function _authorityAllows(authority, sideEffectClass) {
  if (!authority) return false;
  const set = authority.side_effect_classes;
  if (set === '*') return true;
  return Array.isArray(set) && set.includes(sideEffectClass);
}

/** Child authority = delegated ∩ {this action's class} (never widens). */
function _intersectAuthority(parentAuthority, sideEffectClass) {
  if (_authorityAllows(parentAuthority, sideEffectClass)) {
    return { side_effect_classes: [sideEffectClass] };
  }
  return { side_effect_classes: [] };
}

function _isSensitive(privacyClass) {
  return privacyClass === 'sensitive' || privacyClass === 'secret';
}

function _publicAction(action) {
  const { _args, _delegatedAuthority, _approvedIdentityHash, _costCeiling, ...pub } = action;
  return pub;
}

function _hash(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

function _stableStringify(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(_stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + _stableStringify(value[k])).join(',') + '}';
}

/**
 * Canonical frozen-identity hash for an action, exported so an approval service
 * (human/ACSP) binds its one-use receipt to exactly the tuple the pipeline will
 * re-verify: capability + operation + target + canonical_args_hash.
 */
function identityHashOf(action) {
  return _identityHash(action);
}

module.exports = {
  AgentActionPipeline,
  PolicyError,
  ActionDenied,
  STAGES,
  SIDE_EFFECT_CLASSES,
  APPROVAL_REQUIRED,
  identityHashOf,
};
