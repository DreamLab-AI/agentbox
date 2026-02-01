/**
 * Server Integration Patch for ComfyUI
 *
 * Add these changes to server.js:
 *
 * 1. Import ComfyUI modules
 * 2. Initialize ComfyUIManager
 * 3. Register WebSocket support
 * 4. Register ComfyUI routes
 * 5. Add ComfyUI to root endpoint
 * 6. Integrate ComfyUI metrics
 */

// ============================================
// 1. ADD IMPORTS (after existing requires)
// ============================================

const ComfyUIManager = require('./utils/comfyui-manager');
const comfyuiMetrics = require('./utils/metrics-comfyui-extension');

// ============================================
// 2. INITIALIZE MANAGERS (after systemMonitor)
// ============================================

// Initialize ComfyUI manager
const comfyuiManager = new ComfyUIManager(logger, {
  ...metrics,
  ...comfyuiMetrics
});

// Register ComfyUI metrics with main registry
comfyuiMetrics.registerComfyUIMetrics(metrics.register);

// ============================================
// 3. REGISTER WEBSOCKET SUPPORT (before route registration)
// ============================================

// WebSocket support for real-time updates
app.register(require('@fastify/websocket'), {
  options: {
    maxPayload: 1048576, // 1MB
    verifyClient: (info, next) => {
      // Optional: Add authentication for WebSocket connections
      const apiKey = info.req.headers['x-api-key'];
      if (apiKey === API_KEY) {
        next(true);
      } else {
        next(false, 401, 'Unauthorized');
      }
    }
  }
});

// ============================================
// 4. REGISTER COMFYUI ROUTES (after existing routes)
// ============================================

// Register ComfyUI routes
app.register(require('./routes/comfyui'), {
  prefix: '',
  comfyuiManager,
  logger,
  metrics: {
    ...metrics,
    ...comfyuiMetrics
  }
});

// ============================================
// 5. UPDATE ROOT ENDPOINT (replace existing endpoints object)
// ============================================

/*
Replace the endpoints object in the root handler with:
*/

const apiEndpoints = {
  tasks: {
    create: 'POST /v1/tasks',
    get: 'GET /v1/tasks/:taskId',
    list: 'GET /v1/tasks',
    stop: 'DELETE /v1/tasks/:taskId',
    stream: 'GET /v1/tasks/:taskId/logs/stream (SSE)'
  },
  comfyui: {
    submitWorkflow: 'POST /v1/comfyui/workflow',
    getStatus: 'GET /v1/comfyui/workflow/:workflowId',
    listModels: 'GET /v1/comfyui/models',
    listOutputs: 'GET /v1/comfyui/outputs',
    cancelWorkflow: 'DELETE /v1/comfyui/workflow/:workflowId',
    stream: 'WS /v1/comfyui/stream'
  },
  monitoring: {
    status: 'GET /v1/status',
    health: 'GET /health',
    ready: 'GET /ready',
    metrics: 'GET /metrics'
  }
};

// ============================================
// 6. PERIODIC METRICS UPDATE (before start function)
// ============================================

// Update ComfyUI queue metrics every 5 seconds
setInterval(() => {
  const queueLength = comfyuiManager.queue.length;
  comfyuiMetrics.setComfyUIQueueLength(queueLength);
}, 5000);

// ============================================
// EXAMPLE COMPLETE SERVER.JS STRUCTURE
// ============================================

/*
#!/usr/bin/env node

const fastify = require('fastify');
const cors = require('@fastify/cors');
const rateLimit = require('@fastify/rate-limit');
const { createAuthMiddleware } = require('./middleware/auth');
const logger = require('./utils/logger');
const ProcessManager = require('./utils/process-manager');
const SystemMonitor = require('./utils/system-monitor');
const metrics = require('./utils/metrics');

// NEW: ComfyUI imports
const ComfyUIManager = require('./utils/comfyui-manager');
const comfyuiMetrics = require('./utils/metrics-comfyui-extension');

const PORT = process.env.MANAGEMENT_API_PORT || 9090;
const HOST = process.env.MANAGEMENT_API_HOST || '0.0.0.0';
const API_KEY = process.env.MANAGEMENT_API_KEY || 'change-this-secret-key';

const app = fastify({
  logger,
  requestIdLogLabel: 'reqId',
  disableRequestLogging: false,
  trustProxy: true
});

// Initialize managers
const processManager = new ProcessManager(logger);
const systemMonitor = new SystemMonitor(logger);

// NEW: Initialize ComfyUI manager
const comfyuiManager = new ComfyUIManager(logger, {
  ...metrics,
  ...comfyuiMetrics
});

// NEW: Register ComfyUI metrics
comfyuiMetrics.registerComfyUIMetrics(metrics.register);

// Middleware setup...
app.register(cors, { origin: true, credentials: true });
app.register(rateLimit, { max: 100, timeWindow: '1 minute' });

// NEW: WebSocket support
app.register(require('@fastify/websocket'), {
  options: {
    maxPayload: 1048576,
    verifyClient: (info, next) => {
      const apiKey = info.req.headers['x-api-key'];
      next(apiKey === API_KEY, apiKey === API_KEY ? null : 401);
    }
  }
});

// Auth middleware...
const authMiddleware = createAuthMiddleware(API_KEY);
app.addHook('onRequest', async (request, reply) => {
  if (request.url === '/health' || request.url === '/ready' || request.url === '/metrics') {
    return;
  }
  await authMiddleware(request, reply);
});

// Swagger setup...
app.register(require('@fastify/swagger'), { ... });
app.register(require('@fastify/swagger-ui'), { ... });

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

// NEW: Register ComfyUI routes
app.register(require('./routes/comfyui'), {
  prefix: '',
  comfyuiManager,
  logger,
  metrics: { ...metrics, ...comfyuiMetrics }
});

// Metrics endpoint
app.get('/metrics', async (request, reply) => {
  reply.type('text/plain');
  return metrics.register.metrics();
});

// Root endpoint with updated endpoints
app.get('/', async (request, reply) => {
  reply.send({
    name: 'Agentic Flow Management API',
    version: '2.2.0',
    endpoints: {
      tasks: { ... },
      comfyui: {
        submitWorkflow: 'POST /v1/comfyui/workflow',
        getStatus: 'GET /v1/comfyui/workflow/:workflowId',
        listModels: 'GET /v1/comfyui/models',
        listOutputs: 'GET /v1/comfyui/outputs',
        cancelWorkflow: 'DELETE /v1/comfyui/workflow/:workflowId',
        stream: 'WS /v1/comfyui/stream'
      },
      monitoring: { ... }
    },
    documentation: '/docs',
    authentication: 'X-API-Key header required'
  });
});

// Error handler...
app.setErrorHandler((error, request, reply) => {
  logger.error({ error, reqId: request.id }, 'Request error');
  metrics.recordError(error.name || 'UnknownError', request.routerPath || request.url);
  reply.code(error.statusCode || 500).send({
    error: error.name || 'Internal Server Error',
    message: error.message,
    statusCode: error.statusCode || 500
  });
});

// NEW: Periodic metrics update
setInterval(() => {
  const queueLength = comfyuiManager.queue.length;
  comfyuiMetrics.setComfyUIQueueLength(queueLength);
}, 5000);

// Graceful shutdown
async function closeGracefully(signal) {
  logger.info(`Received signal ${signal}, closing server gracefully`);
  processManager.cleanup();
  await app.close();
  process.exit(0);
}

process.on('SIGINT', closeGracefully);
process.on('SIGTERM', closeGracefully);

// Cleanup interval
setInterval(() => {
  processManager.cleanup(3600000);
}, 600000);

// Start server
async function start() {
  try {
    await app.listen({ port: PORT, host: HOST });
    logger.info(`Management API server listening on http://${HOST}:${PORT}`);
    logger.info('ComfyUI integration enabled');
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

start();
*/
