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

const { buildPodNip98 } = require('../lib/pod-signer');
const { wrapDispatch } = require('../observability/metrics');

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

    case 'pods': {
      // Originate signed NIP-98 per request when gated on (default off →
      // nip98 is null → unsigned, byte-identical to prior behaviour).
      const nip98 = buildPodNip98(manifest, {
        onError: (err) =>
          // eslint-disable-next-line no-console
          console.warn(`[adapters] pods NIP-98 signing disabled: ${err.message}`),
      });
      const withSigner = (cfg) => (nip98 ? { ...cfg, nip98 } : cfg);

      if (impl === 'external') {
        return withSigner({ externalUrl: fed.external_url || '' });
      }
      if (impl === 'local-solid-rs') {
        const sp = integrations.solid_pod_rs || {};
        const bind = sp.bind || '127.0.0.1';
        const port = sp.port || 8484;
        return withSigner({ baseUrl: sp.base_url || `http://${bind}:${port}` });
      }
      return {};
    }

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
 * Wrap every public method of a constructed adapter with the canonical
 * middleware chain (ADR-005 observability → ADR-008 privacy filter) via
 * wrapDispatch(). Walks the full prototype chain because pods impls
 * inherit from an intermediate SolidHttpPodsAdapter, not BaseAdapter
 * directly. Lifecycle hooks and underscore-private helpers are skipped:
 * the privacy filter is write-op gated by method name, and connect()
 * failure semantics (degraded-start fallback) must stay unwrapped.
 */
const NON_DISPATCH = new Set(['constructor', 'connect', 'disconnect']);

function instrumentAdapter(adapter, slot, impl, manifest) {
  const seen = new Set();
  let proto = Object.getPrototypeOf(adapter);
  while (proto && proto !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (seen.has(name) || NON_DISPATCH.has(name) || name.startsWith('_')) continue;
      const desc = Object.getOwnPropertyDescriptor(proto, name);
      if (!desc || typeof desc.value !== 'function') continue;
      seen.add(name);
      adapter[name] = wrapDispatch(slot, impl, name, desc.value.bind(adapter), manifest);
    }
    proto = Object.getPrototypeOf(proto);
  }
  return adapter;
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
    resolved[slot] = instrumentAdapter(new AdapterClass(cfg), slot, impl, manifest);

    // Attach meta for health/meta endpoints
    resolved[slot]._implName = impl;
    resolved[slot]._slot = slot;
  }

  return resolved;
}

module.exports = { resolveAdapters, UnknownAdapterImpl, SLOTS };
