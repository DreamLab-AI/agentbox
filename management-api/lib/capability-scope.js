'use strict';

/**
 * capability-scope — ADR-058, lifecycle-scoped capability composition over the
 * adapter spine. A small, native in-process registry that makes every runtime
 * registration (tool, prompt/context contributor, event listener, timer/job,
 * health check, projection) a REVERSIBLE effect owned by a scope. Closing a
 * scope unwinds its effects in reverse registration order, awaits bounded
 * async cleanup, and reports leaks.
 *
 * This is NOT a new ADR-005 adapter slot: capabilities may consume adapters but
 * the five durable-state slots remain the persistence/orchestration spine
 * (ADR-058 D1). It is also NOT runtime plugin discovery — no directory scan,
 * remote fetch, or eval (D5). Trusted code comes from the Nix closure; config
 * layers only select and configure it.
 *
 *   D2  registrations are owned, scoped effects; global/session/agent-child tree
 *   D3  effective tree is inspectable and canonically hashed
 *   D4  provider replacement is transactional (ServiceRegistry.replace)
 *   D5  duplicate identity fails loud; trust class is declared and visible
 *
 * @see ADR-058 §Decision
 * @see docs/reference/adr/ADR-058-lifecycle-scoped-capability-composition.md
 */

const crypto = require('crypto');

const EFFECT_TYPES = Object.freeze([
  'tool', 'prompt', 'listener', 'timer', 'health', 'projection',
]);
const EFFECT_TYPE_SET = new Set(EFFECT_TYPES);

const TRUST_CLASSES = Object.freeze([
  'pure', 'secrets', 'subprocess', 'writes', 'network',
]);

const DEFAULT_DISPOSE_TIMEOUT_MS = 5000;

class CapabilityError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'CapabilityError';
    this.code = code || 'capability_error';
  }
}

/** Registering an identity that already exists anywhere in the tree (D5). */
class DuplicateCapabilityIdentity extends CapabilityError {
  constructor(identity) {
    super(`duplicate capability identity: ${identity} (ADR-058 D2 — identity must be unique in the tree)`, 'duplicate_identity');
    this.name = 'DuplicateCapabilityIdentity';
    this.identity = identity;
  }
}

/**
 * A scope owns a set of effects and a set of child scopes, forming the
 * global → session → agent-child tree. The root scope owns the shared identity
 * registry that enforces uniqueness across the whole tree.
 */
class CapabilityScope {
  /**
   * @param {string} id
   * @param {object} [opts]
   * @param {CapabilityScope} [opts.parent]
   * @param {number} [opts.disposeTimeoutMs]
   */
  constructor(id, opts = {}) {
    if (!id) throw new CapabilityError('scope id is required', 'no_id');
    this.id = id;
    this._parent = opts.parent || null;
    this._disposeTimeoutMs = opts.disposeTimeoutMs || (this._parent ? this._parent._disposeTimeoutMs : DEFAULT_DISPOSE_TIMEOUT_MS);
    this._effects = [];          // registration order; disposed in reverse
    this._children = new Map();  // id -> CapabilityScope
    this._closed = false;
    this._order = 0;
    // Only the root holds the identity registry so duplicates are caught
    // regardless of which scope in the tree registers them.
    this._identities = this._parent ? null : new Set();
  }

  get closed() { return this._closed; }

  /** @private walk to the tree root that owns the identity registry. */
  _rootRegistry() {
    let s = this;
    while (s._parent) s = s._parent;
    return s._identities;
  }

  /**
   * Register a reversible effect. Returns a disposer that removes exactly this
   * effect (and frees its identity) when called directly.
   *
   * @param {object} effect
   * @param {string} effect.capabilityId
   * @param {string} [effect.instanceId='default']
   * @param {string} effect.registrationId
   * @param {string} effect.type          - one of EFFECT_TYPES
   * @param {Function} effect.dispose      - sync or async teardown
   * @param {string} [effect.origin='closure']  - image|profile|operator|cli|closure
   * @param {string} [effect.trustClass='pure'] - one of TRUST_CLASSES
   * @param {object} [effect.meta]
   * @returns {Function} disposer
   */
  register(effect) {
    if (this._closed) throw new CapabilityError(`scope '${this.id}' is closed`, 'scope_closed');
    const e = effect || {};
    if (!e.capabilityId) throw new CapabilityError('capabilityId is required', 'bad_effect');
    if (!e.registrationId) throw new CapabilityError('registrationId is required', 'bad_effect');
    if (!EFFECT_TYPE_SET.has(e.type)) throw new CapabilityError(`unknown effect type: ${e.type}`, 'bad_effect_type');
    if (typeof e.dispose !== 'function') throw new CapabilityError('dispose must be a function', 'bad_effect');
    const trustClass = e.trustClass || 'pure';
    if (!TRUST_CLASSES.includes(trustClass)) throw new CapabilityError(`unknown trust class: ${trustClass}`, 'bad_trust_class');

    const instanceId = e.instanceId || 'default';
    const identity = `${e.capabilityId}+${instanceId}+${e.registrationId}`;
    const registry = this._rootRegistry();
    if (registry.has(identity)) throw new DuplicateCapabilityIdentity(identity);
    registry.add(identity);

    const record = {
      identity,
      capabilityId: e.capabilityId,
      instanceId,
      registrationId: e.registrationId,
      type: e.type,
      origin: e.origin || 'closure',
      trustClass,
      meta: e.meta || {},
      dispose: e.dispose,
      order: this._order++,
      disposed: false,
    };
    this._effects.push(record);

    return () => this._disposeOne(record);
  }

  /** @private dispose a single effect (idempotent); returns a leak or null. */
  async _disposeOne(record) {
    if (record.disposed) return null;
    record.disposed = true;
    this._rootRegistry().delete(record.identity);
    const idx = this._effects.indexOf(record);
    if (idx >= 0) this._effects.splice(idx, 1);
    return _runBounded(record, this._disposeTimeoutMs);
  }

  /** Create (or fetch) a child scope. Closing this scope closes the child. */
  createChild(id) {
    if (this._closed) throw new CapabilityError(`scope '${this.id}' is closed`, 'scope_closed');
    if (this._children.has(id)) return this._children.get(id);
    const child = new CapabilityScope(id, { parent: this, disposeTimeoutMs: this._disposeTimeoutMs });
    this._children.set(id, child);
    return child;
  }

  /** Active (not-yet-disposed) effect count for this scope only. */
  activeEffectCount() { return this._effects.length; }

  /** Deep active effect count including descendants. */
  totalEffectCount() {
    let n = this._effects.length;
    for (const c of this._children.values()) n += c.totalEffectCount();
    return n;
  }

  /**
   * Close this scope: dispose descendants first, then this scope's own effects
   * in reverse registration order, awaiting bounded async cleanup. A child
   * closure can never touch a parent effect — each scope only disposes its own
   * effect list. Idempotent.
   *
   * @returns {Promise<{scope: string, disposed: number, leaked: Array, children: Array}>}
   */
  async close() {
    if (this._closed) return { scope: this.id, disposed: 0, leaked: [], children: [] };
    const childReports = [];
    for (const child of Array.from(this._children.values())) {
      childReports.push(await child.close());
    }
    this._children.clear();

    const leaked = [];
    let disposed = 0;
    // Reverse registration order.
    const ordered = this._effects.slice().sort((a, b) => b.order - a.order);
    for (const record of ordered) {
      const leak = await this._disposeOne(record);
      if (leak) leaked.push(leak); else disposed++;
    }
    this._effects = [];
    this._closed = true;
    return { scope: this.id, disposed, leaked, children: childReports };
  }

  /**
   * Inspectable effective tree (ADR-058 D3): effects with their provider
   * bindings, origins, trust classes and active counts, plus child subtrees.
   */
  effectiveTree() {
    return {
      id: this.id,
      active_effects: this._effects.length,
      effects: this._effects
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((e) => ({
          identity: e.identity,
          capability_id: e.capabilityId,
          instance_id: e.instanceId,
          registration_id: e.registrationId,
          type: e.type,
          origin: e.origin,
          trust_class: e.trustClass,
        })),
      children: Array.from(this._children.values()).map((c) => c.effectiveTree()),
    };
  }

  /**
   * Canonical hash of the effective tree (D3): two nominally identical boots
   * produce the same hash, so they can be compared.
   */
  treeHash() {
    return crypto.createHash('sha256').update(_stableStringify(this.effectiveTree())).digest('hex');
  }
}

/**
 * ServiceRegistry — ADR-058 D4. Replacement is transactional: validate and
 * initialise the candidate provider in an isolated scope, run its health probe,
 * atomically switch the binding, then close the old scope. Failure leaves the
 * old provider authoritative.
 */
class ServiceRegistry {
  /** @param {CapabilityScope} rootScope - parent for provider scopes */
  constructor(rootScope) {
    if (!(rootScope instanceof CapabilityScope)) {
      throw new CapabilityError('ServiceRegistry requires a root CapabilityScope', 'no_root');
    }
    this._root = rootScope;
    this._bindings = new Map(); // serviceId -> { provider, scope }
  }

  get(serviceId) {
    const b = this._bindings.get(serviceId);
    return b ? b.provider : null;
  }

  /**
   * Bind an initial provider, building it inside a fresh isolated scope.
   * @param {string} serviceId
   * @param {(scope: CapabilityScope) => any} build - registers effects, returns provider
   * @returns {any} provider
   */
  bind(serviceId, build) {
    const scope = this._root.createChild(`service:${serviceId}:0`);
    const provider = build(scope);
    this._bindings.set(serviceId, { provider, scope, gen: 0 });
    return provider;
  }

  /**
   * Transactionally replace a provider. On probe failure the old provider stays
   * authoritative and the candidate scope is fully unwound.
   *
   * @param {string} serviceId
   * @param {(scope: CapabilityScope) => any} build
   * @param {(candidate: any) => Promise<boolean>|boolean} healthProbe
   * @returns {Promise<{ok: boolean, provider: any, reason?: string, oldClose?: object}>}
   */
  async replace(serviceId, build, healthProbe) {
    const existing = this._bindings.get(serviceId);
    const gen = existing ? existing.gen + 1 : 0;
    const candidateScope = this._root.createChild(`service:${serviceId}:${gen}`);
    let candidate;
    try {
      candidate = build(candidateScope);
      const healthy = await healthProbe(candidate);
      if (!healthy) throw new CapabilityError('health probe returned false', 'probe_failed');
    } catch (err) {
      // Roll back the candidate entirely; old binding untouched.
      await candidateScope.close();
      return { ok: false, provider: existing ? existing.provider : null, reason: err.message };
    }
    // Atomic switch, then unwind the old scope.
    this._bindings.set(serviceId, { provider: candidate, scope: candidateScope, gen });
    let oldClose;
    if (existing) oldClose = await existing.scope.close();
    return { ok: true, provider: candidate, oldClose };
  }
}

/** Run a disposer under a timeout; returns a leak descriptor or null. */
async function _runBounded(record, timeoutMs) {
  let timer;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('dispose timeout')), timeoutMs);
      if (timer.unref) timer.unref();
    });
    await Promise.race([Promise.resolve().then(() => record.dispose()), timeout]);
    return null;
  } catch (err) {
    return { identity: record.identity, type: record.type, reason: err.message };
  } finally {
    clearTimeout(timer);
  }
}

function _stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(_stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + _stableStringify(value[k])).join(',') + '}';
}

module.exports = {
  CapabilityScope,
  ServiceRegistry,
  CapabilityError,
  DuplicateCapabilityIdentity,
  EFFECT_TYPES,
  TRUST_CLASSES,
};
