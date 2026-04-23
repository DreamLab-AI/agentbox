/**
 * Standalone metrics server on configurable port (default 9091)
 * Serves Prometheus metrics at /metrics endpoint
 * No authentication (standard Prom convention for scraping on trusted networks)
 */

const fastify = require('fastify');
const { register } = require('./metrics');

const METRICS_PORT = process.env.AGENTBOX_METRICS_PORT || 9091;
const METRICS_HOST = process.env.AGENTBOX_METRICS_HOST || '0.0.0.0';

let metricsApp = null;

/**
 * Start the metrics server
 */
async function startMetricsServer() {
  try {
    metricsApp = fastify({
      logger: false
    });

    // GET /metrics — Prometheus format
    metricsApp.get('/metrics', async (request, reply) => {
      reply.type('text/plain; version=0.0.4');
      return register.metrics();
    });

    // Liveness for metrics server (optional)
    metricsApp.get('/health', async (request, reply) => {
      return { status: 'ok', port: METRICS_PORT };
    });

    await metricsApp.listen({ port: METRICS_PORT, host: METRICS_HOST });
    console.log(`[metrics] Server listening on http://${METRICS_HOST}:${METRICS_PORT}`);
    console.log(`[metrics] Prometheus endpoint: http://${METRICS_HOST}:${METRICS_PORT}/metrics`);
  } catch (error) {
    console.error('[metrics] Failed to start metrics server:', error);
    throw error;
  }
}

/**
 * Gracefully shutdown the metrics server
 */
async function shutdownMetricsServer() {
  if (metricsApp) {
    try {
      await metricsApp.close();
      console.log('[metrics] Metrics server shut down');
    } catch (error) {
      console.error('[metrics] Error shutting down metrics server:', error);
    }
  }
}

module.exports = {
  startMetricsServer,
  shutdownMetricsServer
};
