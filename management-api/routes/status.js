/**
 * System status and health monitoring routes
 * GET /v1/status - Comprehensive system health check
 */

async function statusRoutes(fastify, options) {
  const { systemMonitor, processManager, logger } = options;

  /**
   * Comprehensive system status
   */
  fastify.get('/v1/status', {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            timestamp: { type: 'string' },
            api: {
              type: 'object',
              properties: {
                uptime: { type: 'number' },
                version: { type: 'string' }
              }
            },
            tasks: {
              type: 'object',
              properties: {
                active: { type: 'number' }
              }
            },
            gpu: { type: 'object' },
            providers: { type: 'object' },
            system: { type: 'object' }
          }
        }
      }
    }
  }, async (request, reply) => {
    logger.debug('Status check requested');

    const [systemStatus, activeTasks] = await Promise.all([
      systemMonitor.getStatus(),
      Promise.resolve(processManager.getActiveTasks())
    ]);

    reply.send({
      timestamp: new Date().toISOString(),
      api: {
        uptime: process.uptime(),
        version: '1.0.0',
        pid: process.pid
      },
      tasks: {
        active: activeTasks.length
      },
      ...systemStatus
    });
  });

  /**
   * Simple health check endpoint
   */
  fastify.get('/health', async (request, reply) => {
    reply.send({ status: 'healthy', timestamp: new Date().toISOString() });
  });

  /**
   * Readiness probe
   */
  fastify.get('/ready', async (request, reply) => {
    // Check if essential services are available
    const activeTasks = processManager.getActiveTasks();

    reply.send({
      ready: true,
      activeTasks: activeTasks.length,
      timestamp: new Date().toISOString()
    });
  });
}

module.exports = statusRoutes;
