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

  // NOTE: /health and /ready are registered in server.js (before auth middleware).
  // Do not re-register them here.
}

module.exports = statusRoutes;
