#!/usr/bin/env node
/**
 * Agentic Flow Management API Server
 * Provides HTTP endpoints for task management and system monitoring
 */

const fastify = require('fastify');
const cors = require('@fastify/cors');
const rateLimit = require('@fastify/rate-limit');
const websocket = require('@fastify/websocket');
const { createAuthMiddleware } = require('./middleware/auth');
const contractVersions = require('./adapters/contract-versions');
const { resolveAdapters, SLOTS } = require('./adapters/index');
const { loadManifest, ManifestNotFound } = require('./adapters/manifest-loader');
const logger = require('./utils/logger');
const ProcessManager = require('./utils/process-manager');
const SystemMonitor = require('./utils/system-monitor');
const ComfyUIManager = require('./utils/comfyui-manager');
const metrics = require('./utils/metrics');
const observabilityMetrics = require('./observability/metrics');
const { startMetricsServer, shutdownMetricsServer } = require('./observability/metrics-server');
const { initTracing, shutdown: shutdownTracing } = require('./observability/tracing');

// Configuration
const PORT = process.env.MANAGEMENT_API_PORT || 9090;
const HOST = process.env.MANAGEMENT_API_HOST || '0.0.0.0';
const API_KEY = process.env.MANAGEMENT_API_KEY;
if (!API_KEY) {
  console.error('MANAGEMENT_API_KEY environment variable is required');
  process.exit(1);
}

// Initialize Fastify with logger
const app = fastify({
  logger,
  requestIdLogLabel: 'reqId',
  disableRequestLogging: false,
  trustProxy: true
});

// Initialize managers
const processManager = new ProcessManager(logger);
const systemMonitor = new SystemMonitor(logger);
const comfyuiManager = new ComfyUIManager(logger, metrics);

// Adapter health state — populated during startup
// Values: "healthy" | "degraded" | "off"
const adapterHealth = { beads: 'off', pods: 'off', memory: 'off', events: 'off', orchestrator: 'off' };
let resolvedAdapters = null;

// Middleware: CORS
app.register(cors, {
  origin: true,
  credentials: true
});

// Middleware: WebSocket support
app.register(websocket);

// Middleware: Rate limiting
app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
  cache: 10000,
  allowList: ['127.0.0.1'],
  continueExceeding: true,
  skipOnError: false
});

// Metrics tracking middleware
app.addHook('onRequest', async (request, reply) => {
  request.startTime = Date.now();
});

app.addHook('onResponse', async (request, reply) => {
  const duration = (Date.now() - request.startTime) / 1000;
  metrics.recordHttpRequest(
    request.method,
    request.routerPath || request.url,
    reply.statusCode,
    duration
  );
});

// Authentication middleware (applies to all routes except health checks)
const authMiddleware = createAuthMiddleware(API_KEY, {
  authMode: process.env.MANAGEMENT_API_AUTH_MODE || 'hybrid'
});

app.addHook('onRequest', async (request, reply) => {
  // Skip auth for health check endpoints, meta, and metrics
  if (
    request.url === '/health' ||
    request.url === '/ready' ||
    request.url === '/metrics' ||
    request.url === '/v1/meta'
  ) {
    return;
  }

  await authMiddleware(request, reply);
});

// OpenAPI/Swagger
app.register(require('@fastify/swagger'), {
  openapi: {
    openapi: '3.0.0',
    info: {
      title: 'Agentic Flow Management API',
      description: 'HTTP API for managing AI agent workflows and MCP tools',
      version: '2.1.0',
      contact: {
        name: 'Agentic Flow',
        url: 'https://github.com/ruvnet/agentic-flow'
      }
    },
    servers: [
      {
        url: 'http://localhost:9090',
        description: 'Development server'
      }
    ],
    components: {
      securitySchemes: {
        apiKey: {
          type: 'apiKey',
          name: 'X-API-Key',
          in: 'header',
          description: 'API key for authentication'
        }
      }
    },
    security: [{ apiKey: [] }],
    tags: [
      { name: 'tasks', description: 'Task management endpoints' },
      { name: 'monitoring', description: 'System monitoring and health' },
      { name: 'metrics', description: 'Prometheus metrics' },
      { name: 'comfyui', description: 'ComfyUI workflow management' },
      { name: 'agent-events', description: 'Real-time agent action event streaming' }
    ]
  }
});

app.register(require('@fastify/swagger-ui'), {
  routePrefix: '/docs',
  uiConfig: {
    docExpansion: 'list',
    deepLinking: true,
    defaultModelsExpandDepth: 3
  },
  staticCSP: true
});

// Register routes
app.register(require('./routes/tasks'), {
  prefix: '',
  processManager,
  logger,
  metrics
});

app.register(require('./routes/status'), {
  prefix: '',
  systemMonitor,
  processManager,
  logger,
  metrics
});

app.register(require('./routes/comfyui'), {
  prefix: '',
  comfyuiManager,
  logger,
  metrics
});

app.register(require('./routes/agent-events'), {
  prefix: '',
  logger,
  metrics
});

// Health endpoint (public — no auth required)
app.get('/health', {
  schema: {
    description: 'Liveness health check',
    tags: ['monitoring'],
    response: {
      200: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          uptime: { type: 'number' },
          image_hash: { type: ['string', 'null'] },
          manifest_checksum: { type: ['string', 'null'] },
          adapters: { type: 'object' }
        }
      }
    }
  }
}, async (request, reply) => {
  return {
    status: 'ok',
    uptime: process.uptime(),
    image_hash: process.env.AGENTBOX_IMAGE_HASH || null,
    manifest_checksum: process.env.AGENTBOX_MANIFEST_CHECKSUM || null,
    adapters: { ...adapterHealth }
  };
});

// Meta endpoint (public — no auth required, ADR-005 §Contract versioning)
app.get('/v1/meta', {
  schema: {
    description: 'Image and adapter contract metadata',
    tags: ['monitoring'],
    response: {
      200: {
        type: 'object',
        properties: {
          image_hash: { type: ['string', 'null'] },
          manifest_checksum: { type: ['string', 'null'] },
          federation_mode: { type: ['string', 'null'] },
          adapter_contract_versions: {
            type: 'object',
            properties: {
              beads: { type: 'string' },
              pods: { type: 'string' },
              memory: { type: 'string' },
              events: { type: 'string' },
              orchestrator: { type: 'string' }
            }
          },
          adapter_impls: { type: 'object' }
        }
      }
    }
  }
}, async (request, reply) => {
  const adapterImpls = {};
  for (const slot of SLOTS) {
    adapterImpls[slot] = resolvedAdapters ? resolvedAdapters[slot]._implName : 'unknown';
  }
  return {
    image_hash: process.env.AGENTBOX_IMAGE_HASH || null,
    manifest_checksum: process.env.AGENTBOX_MANIFEST_CHECKSUM || null,
    federation_mode: process.env.AGENTBOX_FEDERATION_MODE || null,
    adapter_contract_versions: contractVersions,
    adapter_impls: adapterImpls
  };
});

// Metrics endpoint
app.get('/metrics', {
  schema: {
    description: 'Prometheus metrics endpoint',
    tags: ['metrics'],
    response: {
      200: {
        type: 'string',
        description: 'Prometheus metrics in text format'
      }
    }
  }
}, async (request, reply) => {
  reply.type('text/plain');
  return metrics.register.metrics();
});

// Root endpoint
app.get('/', {
  schema: {
    description: 'API information and available endpoints',
    tags: ['monitoring'],
    response: {
      200: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          version: { type: 'string' },
          endpoints: { type: 'object' },
          documentation: { type: 'string' },
          authentication: { type: 'string' }
        }
      }
    }
  }
}, async (request, reply) => {
  reply.send({
    name: 'Agentic Flow Management API',
    version: '2.1.0',
    endpoints: {
      tasks: {
        create: 'POST /v1/tasks',
        get: 'GET /v1/tasks/:taskId',
        list: 'GET /v1/tasks',
        stop: 'DELETE /v1/tasks/:taskId'
      },
      comfyui: {
        submit: 'POST /v1/comfyui/workflow',
        status: 'GET /v1/comfyui/workflow/:workflowId',
        cancel: 'DELETE /v1/comfyui/workflow/:workflowId',
        models: 'GET /v1/comfyui/models',
        outputs: 'GET /v1/comfyui/outputs',
        stream: 'WS /v1/comfyui/stream'
      },
      agentEvents: {
        stream: 'WS /v1/agent-events/stream',
        recent: 'GET /v1/agent-events',
        emit: 'POST /v1/agent-events/emit',
        batch: 'POST /v1/agent-events/batch',
        types: 'GET /v1/agent-events/types',
        status: 'GET /v1/agent-events/status'
      },
      monitoring: {
        status: 'GET /v1/status',
        health: 'GET /health',
        ready: 'GET /ready',
        metrics: 'GET /metrics'
      }
    },
    documentation: '/docs',
    authentication: 'Authorization: Bearer <token> or Authorization: Nostr <base64-event> (except /health, /ready, /metrics)'
  });
});

// Error handler
app.setErrorHandler((error, request, reply) => {
  logger.error({ error, reqId: request.id }, 'Request error');

  // Record error in metrics
  metrics.recordError(
    error.name || 'UnknownError',
    request.routerPath || request.url
  );

  reply.code(error.statusCode || 500).send({
    error: error.name || 'Internal Server Error',
    message: error.message,
    statusCode: error.statusCode || 500
  });
});

// Graceful shutdown
async function closeGracefully(signal) {
  logger.info(`Received signal ${signal}, closing server gracefully`);

  // Cleanup old tasks
  processManager.cleanup();

  // Shutdown observability
  await shutdownMetricsServer();
  await shutdownTracing();

  // Disconnect all adapters with a 5s total timeout
  if (resolvedAdapters) {
    const disconnectOps = SLOTS.map(async (slot) => {
      const adapter = resolvedAdapters[slot];
      if (typeof adapter.disconnect !== 'function') return;
      try {
        await adapter.disconnect();
        logger.info({ slot }, 'Adapter disconnected');
      } catch (err) {
        logger.error({ slot, err: err.message }, 'Adapter disconnect error (ignored)');
      }
    });

    try {
      await Promise.race([
        Promise.allSettled(disconnectOps),
        new Promise((_, reject) => setTimeout(() => reject(new Error('disconnect timeout')), 5000))
      ]);
    } catch {
      logger.warn('Adapter disconnect did not complete within 5 s, continuing shutdown');
    }
  }

  await app.close();
  process.exit(0);
}

process.on('SIGINT', closeGracefully);
process.on('SIGTERM', closeGracefully);

// Periodic cleanup of old tasks (every 10 minutes)
setInterval(() => {
  processManager.cleanup(3600000); // 1 hour
}, 600000);

// Start server
async function start() {
  try {
    // ── Adapter resolution ──────────────────────────────────────────────
    let manifest;
    try {
      manifest = loadManifest();
      logger.info({ path: process.env.AGENTBOX_MANIFEST_PATH || '/etc/agentbox.toml' }, 'Manifest loaded');
    } catch (err) {
      if (err.name === 'ManifestNotFound') {
        logger.warn({ err: err.message }, 'Manifest not found — using all-off adapter defaults');
        manifest = {};
      } else {
        throw err;
      }
    }

    // ── Provider env-var visibility check ──────────────────────────────
    // Warn for every enabled provider whose primary env var is not set.
    // Does not abort boot — env vars may arrive via secret manager after start.
    const manifestProviders = manifest.providers || {};
    for (const [providerName, provConf] of Object.entries(manifestProviders)) {
      if (!provConf || provConf.enabled !== true) continue;
      const envVar = provConf.env_var || `${providerName.toUpperCase()}_API_KEY`;
      if (!process.env[envVar]) {
        logger.warn(
          { provider: providerName, env_var: envVar },
          `Provider "${providerName}" is enabled but env var "${envVar}" is not set — provider will be non-functional`
        );
      }
    }

    resolvedAdapters = resolveAdapters(manifest);
    app.decorate('adapters', resolvedAdapters);

    // ── Connect adapters (10 s total timeout) ───────────────────────────
    const connectOps = SLOTS.map(async (slot) => {
      const adapter = resolvedAdapters[slot];
      if (typeof adapter.connect !== 'function') {
        adapterHealth[slot] = adapter.enabled === false ? 'off' : 'healthy';
        return;
      }
      try {
        await adapter.connect();
        adapterHealth[slot] = 'healthy';
        logger.info({ slot, impl: adapter._implName }, 'Adapter connected');
      } catch (err) {
        if (slot === 'orchestrator') {
          logger.error({ slot, impl: adapter._implName, err: err.message }, 'Orchestrator adapter failed to connect — FATAL');
          process.exit(1);
        }
        logger.warn({ slot, impl: adapter._implName, err: err.message }, 'Adapter connect failed — falling back to off');
        adapterHealth[slot] = 'degraded';
        // Replace with off impl so callers get AdapterDisabled rather than broken state
        try {
          const { resolveAdapters: re } = require('./adapters/index');
          const offManifest = { adapters: { [slot]: 'off' } };
          const offSlot = re(offManifest)[slot];
          offSlot._implName = 'off';
          offSlot._slot = slot;
          resolvedAdapters[slot] = offSlot;
          app.adapters[slot] = offSlot;
        } catch (_) {
          // If even off fails, leave degraded adapter in place
        }
      }
    });

    try {
      await Promise.race([
        Promise.all(connectOps),
        new Promise((_, reject) => setTimeout(() => reject(new Error('connect timeout')), 10000))
      ]);
    } catch (err) {
      if (err.message === 'connect timeout') {
        logger.warn('Adapter connect phase exceeded 10 s — continuing with partially connected adapters');
      } else {
        throw err;
      }
    }

    // ── Observability ───────────────────────────────────────────────────
    initTracing();
    observabilityMetrics.setBuildInfo();
    await startMetricsServer();

    // ── HTTP server ─────────────────────────────────────────────────────
    await app.listen({ port: PORT, host: HOST });
    logger.info(`Management API server listening on http://${HOST}:${PORT}`);
    logger.info('API Key authentication enabled');
    logger.info(`Set MANAGEMENT_API_KEY environment variable to change the API key`);
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

start();
