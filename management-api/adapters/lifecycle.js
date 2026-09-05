'use strict';

/**
 * Adapter connect lifecycle — ADR-2004 (five adapter slots).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS MODULE EXISTS
 *
 * The previous inline connect phase in server.js had three lifecycle holes the
 * estate review reproduced:
 *
 *   L1  ONE AGGREGATE TIMEOUT. Every slot raced a single 10 s deadline. A slot
 *       whose connect() never settled did not fail — the race rejected, the
 *       handler logged "continuing with partially connected adapters", and
 *       startup proceeded with that slot still holding its ORIGINAL adapter in
 *       an unknown state. Dispatch could then reach a half-connected adapter.
 *
 *   L2  FAILED REPLACEMENT WAS SILENT. When a slot's connect() rejected, the
 *       code swapped in an `off` adapter so callers got AdapterDisabled. If
 *       constructing that replacement itself threw, the catch was
 *       `catch (_) { /* leave degraded adapter in place *\/ }` — the broken
 *       original stayed wired, marked "degraded", and kept receiving dispatch.
 *
 *   L3  NO PER-SLOT READINESS. `adapterHealth` carried healthy/degraded/off
 *       only, was never set at all for a slot caught by the aggregate timeout,
 *       and had no notion of "connecting", "timed out" or "quarantined".
 *
 * ---------------------------------------------------------------------------
 * THE POLICY THIS MODULE IMPLEMENTS
 *
 * TIMEOUT IS LOAD-BEARING, AND IT IS PER SLOT. Each slot gets its own deadline.
 * Exceeding it is a CONNECT FAILURE for that slot — identical in consequence to
 * an explicit rejection — never a reason to continue with the slot in an
 * unknown state. The aggregate wall-clock is therefore bounded by the slowest
 * single slot rather than by a race that abandons work still in flight.
 *
 * AN ADAPTER THAT FAILED TO CONNECT NEVER RECEIVES DISPATCH. On failure the
 * original instance is QUARANTINED: every dispatch method is replaced by a
 * thrower (AdapterQuarantined). This is what makes L1 safe — a connect that
 * settles late finds an object nobody can dispatch into, so a slow sidecar
 * cannot silently become live after the readiness decision was published.
 * `disconnect` is deliberately left callable so shutdown can still release
 * whatever the adapter opened.
 *
 * REPLACEMENT FAILURE IS LOUD AND FAIL-CLOSED. If the `off` replacement cannot
 * be constructed, the slot is left QUARANTINED and marked `unavailable`, so
 * callers get an explicit typed error. The degraded original is never left in
 * place; L2's silent fallback is gone.
 *
 * FAIL-CLOSED SLOTS ABORT STARTUP. `orchestrator` was already fatal on explicit
 * connect rejection. It is now equally fatal on timeout and on quarantine: an
 * orchestrator that never connects is operationally identical to one that
 * refused, and continuing would dispatch orchestration into nothing.
 *
 * READINESS IS PER SLOT AND EXPLICIT. Every slot ends in exactly one state:
 *
 *   off          the slot is not configured (impl 'off', or no connect method)
 *   ready        connect() resolved within the slot deadline
 *   disabled     connect failed; an `off` replacement is wired and dispatch
 *                returns AdapterDisabled
 *   unavailable  connect failed AND the replacement could not be built; the
 *                slot is quarantined and dispatch throws AdapterQuarantined
 *
 * plus, on the record for each non-ready slot, the reason and the failure mode
 * (`rejected` | `timeout` | `replacement-failed`) and whether a late settle was
 * observed after the deadline.
 * ---------------------------------------------------------------------------
 */

const DEFAULT_CONNECT_TIMEOUT_MS = 10000;

// Slots whose failure to connect must abort startup rather than degrade.
const FAIL_CLOSED_SLOTS = new Set(['orchestrator']);

// Lifecycle hooks that must survive quarantine so shutdown can still run.
const QUARANTINE_EXEMPT = new Set(['constructor', 'disconnect']);

class AdapterQuarantined extends Error {
  constructor(slot, method, reason) {
    super(
      `AdapterQuarantined[${slot}]: refusing ${method}() — this adapter failed to ` +
      `connect (${reason}) and has been withdrawn from dispatch. It is never ` +
      `re-armed, even if its connect settles later.`,
    );
    this.name = 'AdapterQuarantined';
    this.slot = slot;
    this.method = method;
    this.reason = reason;
    this.statusCode = 503;
  }
}

class AdapterConnectTimeout extends Error {
  constructor(slot, ms) {
    super(`AdapterConnectTimeout[${slot}]: connect() did not settle within ${ms} ms`);
    this.name = 'AdapterConnectTimeout';
    this.slot = slot;
    this.timeoutMs = ms;
  }
}

/**
 * Resolve the connect deadline for a slot.
 *
 * Manifest contract (all optional, milliseconds):
 *   [adapters] connect_timeout_ms          = 10000    # applies to every slot
 *   [adapters.connect_timeout_ms] <slot>   = 2000     # per-slot override
 *
 * A non-positive or non-finite value is ignored in favour of the default: a
 * zero deadline would fail every slot before it could connect, which is a
 * configuration mistake rather than a policy anyone means to express.
 *
 * @param {string} slot
 * @param {object|null} manifest
 * @returns {number} milliseconds
 */
function connectTimeoutFor(slot, manifest) {
  const adapters = (manifest && manifest.adapters) || {};
  const raw = adapters.connect_timeout_ms;
  let value;
  if (raw !== null && typeof raw === 'object') value = raw[slot] !== undefined ? raw[slot] : raw.default;
  else value = raw;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CONNECT_TIMEOUT_MS;
}

/**
 * Withdraw an adapter from dispatch permanently.
 *
 * Walks the instance's own properties (instrumentAdapter installs the wrapped
 * dispatch methods there) and the whole prototype chain, replacing every
 * callable with a thrower. Underscore-private helpers and the lifecycle hooks
 * in QUARANTINE_EXEMPT are left alone.
 *
 * @param {object} adapter
 * @param {string} slot
 * @param {string} reason
 * @returns {object} the same adapter, now inert
 */
function quarantineAdapter(adapter, slot, reason) {
  if (!adapter || typeof adapter !== 'object') return adapter;
  const names = new Set();
  for (const name of Object.getOwnPropertyNames(adapter)) names.add(name);
  let proto = Object.getPrototypeOf(adapter);
  while (proto && proto !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(proto)) names.add(name);
    proto = Object.getPrototypeOf(proto);
  }
  for (const name of names) {
    if (QUARANTINE_EXEMPT.has(name) || name.startsWith('_')) continue;
    let current;
    try { current = adapter[name]; } catch { continue; }
    if (typeof current !== 'function') continue;
    try {
      Object.defineProperty(adapter, name, {
        // async, so the refusal arrives as a rejected promise: adapter methods
        // are awaited, and a synchronous throw would surface differently from
        // every other adapter error the callers already handle.
        value: async function quarantined() { throw new AdapterQuarantined(slot, name, reason); },
        writable: true, configurable: true, enumerable: false,
      });
    } catch { /* non-configurable: the readiness record still marks the slot */ }
  }
  adapter._quarantined = true;
  adapter._quarantineReason = reason;
  return adapter;
}

/**
 * Connect one slot under its own deadline.
 *
 * Returns {settled:'resolved'|'rejected'|'timeout', error, latePromise}. When
 * the deadline wins, `latePromise` is the still-running connect: the caller
 * attaches a handler so a late rejection cannot surface as an unhandled
 * rejection and a late resolution is recorded rather than acted upon.
 */
async function connectOneSlot(adapter, slot, timeoutMs, timers) {
  const setT = (timers && timers.setTimeout) || setTimeout;
  const clearT = (timers && timers.clearTimeout) || clearTimeout;

  let timer;
  const connectPromise = Promise.resolve().then(() => adapter.connect());
  // Swallow at the source so an abandoned promise can never become an
  // unhandled rejection; the outcome is still observable through `.then` below.
  const observed = connectPromise.then(
    (v) => ({ settled: 'resolved', value: v }),
    (error) => ({ settled: 'rejected', error }),
  );
  // The timer is deliberately NOT unref()'d: an unreferenced deadline lets the
  // event loop drain first, so a never-settling connect would end the process
  // before the deadline could fire — reinstating exactly the ambiguity this
  // module exists to remove. It is cleared as soon as the race settles.
  const timeout = new Promise((resolve) => {
    timer = setT(() => resolve({ settled: 'timeout', error: new AdapterConnectTimeout(slot, timeoutMs) }), timeoutMs);
  });

  const outcome = await Promise.race([observed, timeout]);
  clearT(timer);
  return outcome.settled === 'timeout' ? { ...outcome, latePromise: observed } : outcome;
}

/**
 * Connect every slot, applying the policy documented at the top of this file.
 *
 * @param {object}   opts
 * @param {string[]} opts.slots           slot names, in the order to report
 * @param {object}   opts.adapters        mutable slot -> adapter map (updated in place)
 * @param {object|null} opts.manifest     parsed manifest (for timeouts)
 * @param {object}   [opts.logger]        pino-compatible logger
 * @param {Function} opts.resolveOff      (slot) => adapter, builds the `off` replacement
 * @param {Function} [opts.onFatal]       called as (slot, record) when a fail-closed
 *                                        slot cannot connect; defaults to process.exit(1)
 * @param {object}   [opts.timers]        {setTimeout, clearTimeout} injection point for tests
 * @param {Set<string>} [opts.failClosedSlots]
 * @returns {Promise<{readiness: object, healthy: boolean}>}
 */
async function connectAdapters(opts) {
  const {
    slots, adapters, manifest = null, logger = null, resolveOff,
    onFatal = null, timers = null, failClosedSlots = FAIL_CLOSED_SLOTS,
  } = opts;

  const log = {
    info: (o, m) => logger && logger.info && logger.info(o, m),
    warn: (o, m) => logger && logger.warn && logger.warn(o, m),
    error: (o, m) => logger && logger.error && logger.error(o, m),
  };

  const readiness = {};
  const fatals = [];

  await Promise.all(slots.map(async (slot) => {
    const adapter = adapters[slot];
    const impl = (adapter && adapter._implName) || 'unknown';
    const timeoutMs = connectTimeoutFor(slot, manifest);
    const started = Date.now();

    if (!adapter || typeof adapter.connect !== 'function') {
      readiness[slot] = {
        slot, impl, state: adapter && adapter.enabled === false ? 'off' : 'ready',
        reason: 'no connect() hook — nothing to establish', timeoutMs, durationMs: 0,
        failureMode: null, lateSettle: null,
      };
      return;
    }

    const outcome = await connectOneSlot(adapter, slot, timeoutMs, timers);
    const durationMs = Date.now() - started;

    if (outcome.settled === 'resolved') {
      readiness[slot] = { slot, impl, state: 'ready', reason: null, timeoutMs, durationMs, failureMode: null, lateSettle: null };
      log.info({ slot, impl, durationMs }, 'Adapter connected');
      return;
    }

    const failureMode = outcome.settled === 'timeout' ? 'timeout' : 'rejected';
    const reason = outcome.error ? outcome.error.message : 'connect failed';
    const record = { slot, impl, state: 'unavailable', reason, timeoutMs, durationMs, failureMode, lateSettle: null };
    readiness[slot] = record;

    // A slot that timed out is still running somewhere. Record what it does
    // eventually — an operator needs to tell "the sidecar is slow" from "the
    // sidecar is broken" — but never re-arm it.
    if (outcome.latePromise) {
      outcome.latePromise.then((late) => {
        record.lateSettle = late.settled;
        log.warn({ slot, impl, lateSettle: late.settled, error: late.error && late.error.message },
          'Adapter connect settled AFTER its deadline — the slot stays withdrawn');
      });
    }

    // The instance is withdrawn BEFORE any replacement is attempted, so there is
    // no window in which a half-connected adapter is reachable.
    quarantineAdapter(adapter, slot, `${failureMode}: ${reason}`);

    if (failClosedSlots.has(slot)) {
      log.error({ slot, impl, err: reason, failureMode },
        'Fail-closed adapter slot failed to connect — FATAL');
      fatals.push(record);
      return;
    }

    log.warn({ slot, impl, err: reason, failureMode }, 'Adapter connect failed — replacing with the off implementation');
    try {
      const offSlot = resolveOff(slot);
      if (!offSlot) throw new Error('resolveOff returned nothing');
      offSlot._implName = 'off';
      offSlot._slot = slot;
      adapters[slot] = offSlot;
      record.state = 'disabled';
      record.replacement = 'off';
    } catch (replErr) {
      // L2: never fall back to leaving the broken original wired.
      record.state = 'unavailable';
      record.failureMode = 'replacement-failed';
      record.replacementError = replErr && replErr.message;
      log.error({ slot, impl, err: replErr && replErr.message, originalReason: reason },
        'Adapter off-replacement could not be constructed — slot left QUARANTINED; '
        + 'dispatch will throw AdapterQuarantined rather than reach a degraded adapter');
    }
  }));

  if (fatals.length) {
    const fatal = onFatal || ((slot, record) => {
      // eslint-disable-next-line no-console
      console.error(`[adapters] fail-closed slot ${slot} unavailable (${record.reason}) — aborting startup`);
      process.exit(1);
    });
    for (const record of fatals) fatal(record.slot, record);
  }

  const healthy = Object.values(readiness).every((r) => r.state === 'ready' || r.state === 'off');
  return { readiness, healthy };
}

/**
 * Collapse the readiness map to the legacy healthy/degraded/off vocabulary the
 * /health payload already publishes, so existing consumers keep working while
 * the richer per-slot record is available alongside it.
 *
 * @param {object} readiness
 * @returns {object} slot -> 'healthy'|'degraded'|'off'
 */
function toLegacyHealth(readiness) {
  const out = {};
  for (const [slot, r] of Object.entries(readiness)) {
    out[slot] = r.state === 'ready' ? 'healthy' : (r.state === 'off' ? 'off' : 'degraded');
  }
  return out;
}

module.exports = {
  connectAdapters,
  connectTimeoutFor,
  quarantineAdapter,
  toLegacyHealth,
  AdapterQuarantined,
  AdapterConnectTimeout,
  DEFAULT_CONNECT_TIMEOUT_MS,
  FAIL_CLOSED_SLOTS,
};
