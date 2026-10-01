/**
 * OpenTelemetry tracing setup with OTLP exporter
 * Reads endpoint from AGENTBOX_OTLP_ENDPOINT; if unset, uses no-op tracer
 */

const { trace } = require('@opentelemetry/api');
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');

let sdk = null;
let tracer = null;

/**
 * Initialize OpenTelemetry tracing
 * If AGENTBOX_OTLP_ENDPOINT is set, exports to that endpoint
 * Otherwise uses a no-op tracer (null tracer — startSpan returns no-op)
 */
function initTracing() {
  const endpoint = process.env.AGENTBOX_OTLP_ENDPOINT;

  if (!endpoint) {
    console.log('[tracing] AGENTBOX_OTLP_ENDPOINT not set, using no-op tracer');
    tracer = null;
    return;
  }

  try {
    const exporter = new OTLPTraceExporter({
      url: endpoint
    });

    sdk = new NodeSDK({
      traceExporter: exporter,
      instrumentations: [getNodeAutoInstrumentations()]
    });

    sdk.start();
    // NodeSDK registers its provider globally on start(); it exposes no
    // provider getter, so manual spans go through the global API.
    tracer = trace.getTracer('agentbox');
    console.log(`[tracing] Started OpenTelemetry SDK, exporting to ${endpoint}`);
  } catch (error) {
    console.error('[tracing] Failed to initialize OpenTelemetry:', error.message);
    tracer = null;
  }
}

/**
 * Start a span with attributes
 * @param {string} name - Span name
 * @param {Object} attributes - Span attributes
 * @returns {Function} A function that ends the span
 */
function startSpan(name, attributes = {}) {
  if (!tracer) {
    return () => {}; // No-op
  }

  try {
    const span = tracer.startSpan(name);

    Object.entries(attributes).forEach(([key, value]) => {
      span.setAttribute(key, value);
    });

    return () => {
      span.end();
    };
  } catch (error) {
    console.error('[tracing] Failed to start span:', error.message);
    return () => {}; // No-op
  }
}

/**
 * Gracefully shutdown the SDK
 */
async function shutdown() {
  if (sdk) {
    try {
      await sdk.shutdown();
      console.log('[tracing] OpenTelemetry SDK shutdown');
    } catch (error) {
      console.error('[tracing] Error shutting down SDK:', error.message);
    }
  }
}

module.exports = {
  initTracing,
  startSpan,
  shutdown
};
