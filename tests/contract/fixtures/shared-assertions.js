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

module.exports = { assertMethodShape, assertContractVersion, assertOffClassThrows };
