'use strict';

/**
 * Shared behavioural-equivalence assertions used by all five contract suites.
 *
 * Philosophy: the harness tests *shape* (method presence, error types, contract
 * version format) so that real implementations can be dropped in without
 * changing a single test line.  Full behavioural equivalence (same output for
 * same input across all impls) is asserted in the `it.todo` blocks that are
 * promoted once a real implementation exists.
 */

const { EXPECTED_CONTRACT_VERSIONS, SEMVER_RE } = require('./contract-versions.fixture');

/**
 * Assert that an adapter instance exposes every required method name.
 *
 * @param {object} instance  - The adapter under test.
 * @param {string[]} methods - Required method names per the slot interface.
 */
function assertMethodShape(instance, methods) {
  for (const method of methods) {
    if (typeof instance[method] !== 'function') {
      throw new Error(
        `Adapter is missing required method '${method}'. ` +
        `Found keys: ${Object.getOwnPropertyNames(Object.getPrototypeOf(instance)).join(', ')}`
      );
    }
  }
}

/**
 * Assert that the adapter's reported CONTRACT_VERSION is a valid semver string
 * and matches the expected version for this slot.
 *
 * @param {object} instance - The adapter under test.
 * @param {string} slot     - Slot name ('beads' | 'pods' | 'memory' | 'events' | 'orchestrator').
 */
function assertContractVersion(instance, slot) {
  const version = instance.CONTRACT_VERSION;
  if (!version) throw new Error('Adapter must expose CONTRACT_VERSION');
  if (!SEMVER_RE.test(version)) {
    throw new Error(`CONTRACT_VERSION '${version}' is not valid semver`);
  }
  const expected = EXPECTED_CONTRACT_VERSIONS[slot];
  if (!expected) throw new Error(`No expected version registered for slot '${slot}'`);
  if (version !== expected) {
    throw new Error(
      `Contract version mismatch for slot '${slot}': got '${version}', expected '${expected}'`
    );
  }
}

/**
 * Assert that every method on an `off`-class adapter throws AdapterDisabled,
 * not any other error type or a silent no-op.
 *
 * @param {object}   instance       - The off-class adapter.
 * @param {string[]} methods        - Methods that must throw.
 * @param {Function} AdapterDisabledClass - The error class to check against.
 */
async function assertOffClassThrows(instance, methods, AdapterDisabledClass) {
  for (const method of methods) {
    let threw = false;
    let caughtError;
    try {
      await instance[method]();
    } catch (err) {
      threw = true;
      caughtError = err;
    }
    if (!threw) {
      throw new Error(`off-class method '${method}' must throw AdapterDisabled, but it returned`);
    }
    if (!(caughtError instanceof AdapterDisabledClass)) {
      throw new Error(
        `off-class method '${method}' threw ${caughtError.name} instead of AdapterDisabled`
      );
    }
  }
}

/**
 * ADR-031 §Registered exemption protocol.
 *
 * When an impl's `[M2]` behavioural block genuinely cannot run in CI (no live
 * host, no feasible loopback), it may declare a registered exemption INSTEAD of
 * a silent `isReal: false` skip. This helper makes the exemption loud and
 * well-formed: it throws if any required field is missing or expired, and emits
 * a warning naming the slot/impl so the exemption can never pass as a green
 * silent skip.
 *
 * Required shape:
 *   { reason: string, owner: string, tracking: string, expires: ISO-8601 date }
 *
 * @param {string} slot
 * @param {string} impl
 * @param {object} exemption
 * @param {object} [warn] - sink with a .warn(msg) method (default: console)
 */
function assertRegisteredExemption(slot, impl, exemption, warn = console) {
  if (!exemption || typeof exemption !== 'object') {
    throw new Error(
      `[ADR-031] ${slot}::${impl} declared isReal:false without a registered ` +
      `exemption object — silent skips are banned. Provide ` +
      `{ reason, owner, tracking, expires } or make the impl real.`
    );
  }
  const missing = ['reason', 'owner', 'tracking', 'expires'].filter(
    (k) => typeof exemption[k] !== 'string' || exemption[k].length === 0,
  );
  if (missing.length) {
    throw new Error(
      `[ADR-031] ${slot}::${impl} exemption is malformed — missing/empty: ${missing.join(', ')}`
    );
  }
  const expiry = Date.parse(exemption.expires);
  if (Number.isNaN(expiry)) {
    throw new Error(`[ADR-031] ${slot}::${impl} exemption.expires is not an ISO-8601 date: '${exemption.expires}'`);
  }
  if (expiry < Date.now()) {
    throw new Error(
      `[ADR-031] ${slot}::${impl} exemption EXPIRED on ${exemption.expires} ` +
      `(tracking: ${exemption.tracking}, owner: ${exemption.owner}). ` +
      `Renew the tracking ref or make the impl real.`
    );
  }
  (warn.warn || warn.log || console.warn).call(
    warn,
    `[ADR-031] REGISTERED EXEMPTION — ${slot}::${impl} skips [M2] behavioural ` +
    `assertions. reason="${exemption.reason}" owner=${exemption.owner} ` +
    `tracking=${exemption.tracking} expires=${exemption.expires}`
  );
}

/**
 * Measure the p95 latency (in milliseconds) of an async operation over a
 * sequential run against the real in-process adapter.
 *
 * This is the ADR-005 §Service-level-objectives *floor* measurement: it runs
 * the operation `iterations` times back-to-back (after `warmup` untimed calls)
 * and returns the 95th-percentile per-call latency. A sequential p95 is a
 * necessary condition for the concurrent load SLO — if the single-caller floor
 * already exceeds the budget the load SLO cannot pass — so the contract suite
 * asserts it directly against the real adapter, while the full concurrent
 * "at N req/s" figure is measured by the nightly k6 harness.
 *
 * @param {(i:number)=>Promise<any>} fn  - Operation to time; receives the iteration index.
 * @param {object} [opts]
 * @param {number} [opts.iterations=200] - Timed samples.
 * @param {number} [opts.warmup=20]      - Untimed warm-up calls.
 * @returns {Promise<number>} p95 latency in milliseconds.
 */
async function measureP95(fn, { iterations = 200, warmup = 20 } = {}) {
  for (let i = 0; i < warmup; i++) await fn(i);
  const samples = new Array(iterations);
  for (let i = 0; i < iterations; i++) {
    const t = process.hrtime.bigint();
    await fn(i);
    samples[i] = Number(process.hrtime.bigint() - t) / 1e6;
  }
  samples.sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil(samples.length * 0.95) - 1);
  return samples[idx];
}

module.exports = {
  assertMethodShape,
  assertContractVersion,
  assertOffClassThrows,
  assertRegisteredExemption,
  measureP95,
};
