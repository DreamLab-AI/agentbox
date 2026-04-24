'use strict';

/**
 * Adapter resolver — ADR-005 §Adapter dispatch.
 *
 * resolveAdapters(manifest) -> { beads, pods, memory, events, orchestrator }
 *
 * Each slot holds a constructed (but not yet connected) adapter instance.
 * Call adapter.connect() after resolution; call adapter.disconnect() on shutdown.
 */

const path = require('path');

const SLOTS = ['beads', 'pods', 'memory', 'events', 'orchestrator'];

class UnknownAdapterImpl extends Error {
  constructor(slot, impl) {
    super(
      `Unknown adapter implementation '${impl}' for slot '${slot}'. ` +
      `Expected a file at adapters/${slot}/${impl}.js`
    );
    this.name = 'UnknownAdapterImpl';
    this.slot = slot;
    this.impl = impl;
  }
}

/**
 * Build slot-specific config from the manifest.
 * Keeps all config extraction in one place so the resolver stays thin.
 */
function slotConfig(slot, impl, manifest) {
  const fed = manifest.federation || {};
  const integrations = manifest.integrations || {};

  switch (slot) {
    case 'memory':
      if (impl === 'external-pg') {
        return { conninfo: (integrations.ruvector_external || {}).conninfo || '' };
      }
      return {};

    case 'beads':
    case 'events':
      if (impl === 'external') {
        return { externalUrl: fed.external_url || '' };
      }
      return {};

    case 'pods':
      if (impl === 'external') {
        return { externalUrl: fed.external_url || '' };
      }
      if (impl === 'local-solid-rs') {
        const sp = integrations.solid_pod_rs || {};
        const bind = sp.bind || '127.0.0.1';
        const port = sp.port || 8484;
        return { baseUrl: sp.base_url || `http://${bind}:${port}` };
      }
      return {};

    case 'orchestrator':
      if (impl === 'stdio-bridge') {
        const ext = integrations.external_orchestrator || {};
        return {
          externalUrl: fed.external_url || '',
          protocol: ext.protocol || 'stdio',
        };
      }
      if (impl === 'external') {
        return { externalUrl: fed.external_url || '' };
      }
      return {};

    default:
      return {};
  }
}

/**
 * Dynamically require an adapter implementation.
 * Falls back to placeholder.js when impl === 'off' and off.js doesn't exist yet
 * (covers the period before the parallel adapter-triple task delivers all off impls).
 * @throws {UnknownAdapterImpl} if neither the requested impl nor the placeholder is found.
 */
function requireImpl(slot, impl) {
  const implPath = path.resolve(__dirname, slot, `${impl}.js`);
  try {
    return require(implPath);
  } catch (err) {
    if (err.code !== 'MODULE_NOT_FOUND' || !err.message.includes(implPath)) {
      throw err;
    }
    // For 'off', fall back to placeholder.js during the period before real off impls land
    if (impl === 'off') {
      const fallback = path.resolve(__dirname, slot, 'placeholder.js');
      try {
        return require(fallback);
      } catch {
        // placeholder also missing — fall through to UnknownAdapterImpl
      }
    }
    throw new UnknownAdapterImpl(slot, impl);
  }
}

/**
 * Resolve all five adapter slots from the parsed manifest.
 *
 * @param {object} manifest - Parsed agentbox.toml object
 * @returns {{ beads, pods, memory, events, orchestrator }} - Constructed adapter instances
 */
function resolveAdapters(manifest) {
  const adapterDecls = manifest.adapters || {};
  const resolved = {};

  for (const slot of SLOTS) {
    const impl = adapterDecls[slot] || 'off';
    const mod = requireImpl(slot, impl);

    // Convention: each adapter module exports a default class as its first export,
    // or a named export matching the slot (e.g. BeadsAdapter, MemoryAdapter).
    // Fall back to the module itself if it's already a constructor.
    const AdapterClass =
      mod.default ||
      mod[Object.keys(mod).find(k => typeof mod[k] === 'function')] ||
      mod;

    const cfg = slotConfig(slot, impl, manifest);
    resolved[slot] = new AdapterClass(cfg);

    // Attach meta for health/meta endpoints
    resolved[slot]._implName = impl;
    resolved[slot]._slot = slot;
  }

  return resolved;
}

module.exports = { resolveAdapters, UnknownAdapterImpl, SLOTS };
