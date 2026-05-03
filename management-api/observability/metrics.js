/**
 * Prometheus metrics registry and instrumentation (ADR-005 §Observability)
 * Instruments: adapter dispatch, adapter health, build info
 * Exports: registry, counter/histogram/gauge getters, wrapDispatch() wrapper
 */

const promClient = require('prom-client');
const uris = require('../lib/uris');
const { wrapWithPrivacyFilter } = require('../middleware/privacy-filter');

// Prometheus registry
const register = new promClient.Registry();

// Register default Node process metrics
promClient.collectDefaultMetrics({ register });

// Counter: adapter dispatch outcomes
const adapterDispatchTotal = new promClient.Counter({
  name: 'agentbox_adapter_dispatch_total',
  help: 'Total adapter dispatch attempts by slot, method, implementation, and outcome',
  labelNames: ['slot', 'method', 'impl', 'outcome'],
  registers: [register]
});

// Histogram: adapter dispatch latency (seconds)
const adapterDurationSeconds = new promClient.Histogram({
  name: 'agentbox_adapter_duration_seconds',
  help: 'Adapter dispatch latency in seconds',
  labelNames: ['slot', 'method', 'impl'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register]
});

// Gauge: adapter health (0=unhealthy, 1=healthy, 2=degraded)
const adapterHealth = new promClient.Gauge({
  name: 'agentbox_adapter_health',
  help: 'Adapter health status (0=unhealthy, 1=healthy, 2=degraded)',
  labelNames: ['slot', 'impl'],
  registers: [register]
});

// Gauge: build info (static, always 1)
const buildInfo = new promClient.Gauge({
  name: 'agentbox_build_info',
  help: 'Build information (always 1)',
  labelNames: ['image_hash', 'manifest_checksum', 'federation_mode'],
  registers: [register]
});

/**
 * Set build info gauge with environment values
 */
function setBuildInfo() {
  const imageHash = process.env.AGENTBOX_IMAGE_HASH || 'unknown';
  const manifestChecksum = process.env.AGENTBOX_MANIFEST_CHECKSUM || 'unknown';
  const federationMode = process.env.AGENTBOX_FEDERATION_MODE || 'unknown';

  buildInfo.labels(imageHash, manifestChecksum, federationMode).set(1);
}

/**
 * Wrap an adapter method with the three canonical middleware layers:
 *
 *   Layer 1: Observability  (this function — metrics + structured log)
 *   Layer 2: Privacy filter (ADR-008 — wrapWithPrivacyFilter)
 *   Layer 3: JSON-LD encoder (ADR-012 — caller must invoke encoder.dispatch
 *                              after this wrapper returns)
 *
 * DDD-004 §L08: privacy redaction completes before the encoder runs.
 * The ordering is asserted at runtime via assertPrivacyFilterApplied().
 *
 * @param {string} slot - Adapter slot (beads, pods, memory, events, orchestrator)
 * @param {string} impl - Implementation name (e.g., local-sqlite, external)
 * @param {string} methodName - Method name (e.g., createEpic, store)
 * @param {Function} fn - Async function to wrap (should be (args) => Promise)
 * @param {object|null} [manifest] - Parsed agentbox.toml; required for privacy policy
 * @returns {Function} Wrapped function that records metrics and tracing
 */
function wrapDispatch(slot, impl, methodName, fn, manifest = null) {
  // Layer 2: privacy filter wraps the raw adapter call
  const privacyWrapped = wrapWithPrivacyFilter(slot, methodName, fn, manifest);

  return async function instrumentedDispatch(...args) {
    const startTime = Date.now();
    const startHrTime = process.hrtime.bigint();

    const pubkey = process.env.AGENTBOX_PUBKEY || '0'.repeat(64);
    const executionId = uris.mint({ kind: 'event', pubkey, payload: { slot, impl, method: methodName, ts: Date.now() } });
    const sessionId = process.env.SESSION_ID || 'unknown';

    try {
      // Layer 2 (privacy) is applied inside privacyWrapped; Layer 1 timing
      // wraps it so the full redaction latency is included in the dispatch span.
      const result = await privacyWrapped(...args);

      const endHrTime = process.hrtime.bigint();
      const durationMs = Number(endHrTime - startHrTime) / 1_000_000;
      const durationSeconds = durationMs / 1000;

      // Record success metrics
      adapterDispatchTotal.labels(slot, methodName, impl, 'success').inc();
      adapterDurationSeconds.labels(slot, methodName, impl).observe(durationSeconds);

      // Structured log
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: 'info',
          msg: 'adapter_dispatch',
          slot,
          method: methodName,
          impl,
          duration_ms: Math.round(durationMs),
          session_id: sessionId,
          execution_id: executionId,
          outcome: 'success'
        })
      );

      return result;
    } catch (error) {
      const endHrTime = process.hrtime.bigint();
      const durationMs = Number(endHrTime - startHrTime) / 1_000_000;
      const durationSeconds = durationMs / 1000;

      // Record error metrics
      adapterDispatchTotal.labels(slot, methodName, impl, 'error').inc();
      adapterDurationSeconds.labels(slot, methodName, impl).observe(durationSeconds);

      // Structured log (error)
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: 'error',
          msg: 'adapter_dispatch_error',
          slot,
          method: methodName,
          impl,
          duration_ms: Math.round(durationMs),
          session_id: sessionId,
          execution_id: executionId,
          outcome: 'error',
          error: error.message,
          stack: error.stack
        })
      );

      throw error;
    }
  };
}

/**
 * Set adapter health gauge
 */
function setAdapterHealth(slot, impl, status) {
  const statusValue = status === 'healthy' ? 1 : status === 'degraded' ? 2 : 0;
  adapterHealth.labels(slot, impl).set(statusValue);
}

module.exports = {
  register,
  setBuildInfo,
  wrapDispatch,
  setAdapterHealth,
  // Getters for direct access if needed
  adapterDispatchTotal,
  adapterDurationSeconds,
  adapterHealth,
  buildInfo
};
