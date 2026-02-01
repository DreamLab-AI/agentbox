/**
 * Task management routes
 * POST /v1/tasks - Create and start a new task
 * GET /v1/tasks/:taskId - Get task status and results
 */

async function tasksRoutes(fastify, options) {
  const { processManager, logger } = options;

  /**
   * Create and start a new task
   */
  fastify.post('/v1/tasks', {
    schema: {
      body: {
        type: 'object',
        required: ['agent', 'task'],
        properties: {
          agent: { type: 'string' },
          task: { type: 'string' },
          provider: { type: 'string', default: 'claude-flow' }
        }
      },
      response: {
        202: {
          type: 'object',
          properties: {
            taskId: { type: 'string' },
            status: { type: 'string' },
            message: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { agent, task, provider = 'claude-flow' } = request.body;

    logger.info({ agent, provider, task: task.substring(0, 100) }, 'Creating new task');

    try {
      const processInfo = processManager.spawnTask(agent, task, provider);

      reply.code(202).send({
        taskId: processInfo.taskId,
        status: 'accepted',
        message: 'Task started successfully',
        taskDir: processInfo.taskDir,
        logFile: processInfo.logFile
      });
    } catch (error) {
      logger.error({ error: error.message }, 'Failed to spawn task');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to start task',
        details: error.message
      });
    }
  });

  /**
   * Get task status and results
   */
  fastify.get('/v1/tasks/:taskId', {
    schema: {
      params: {
        type: 'object',
        properties: {
          taskId: { type: 'string' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            taskId: { type: 'string' },
            agent: { type: 'string' },
            task: { type: 'string' },
            provider: { type: 'string' },
            status: { type: 'string' },
            startTime: { type: 'number' },
            exitTime: { type: ['number', 'null'] },
            exitCode: { type: ['number', 'null'] },
            duration: { type: 'number' },
            logTail: { type: 'string' }
          }
        },
        404: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            message: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { taskId } = request.params;

    const status = processManager.getTaskStatus(taskId);

    if (!status) {
      return reply.code(404).send({
        error: 'Not Found',
        message: `Task ${taskId} not found`
      });
    }

    reply.send(status);
  });

  /**
   * List all active tasks
   */
  fastify.get('/v1/tasks', {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            activeTasks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  taskId: { type: 'string' },
                  agent: { type: 'string' },
                  startTime: { type: 'number' },
                  duration: { type: 'number' }
                }
              }
            },
            count: { type: 'number' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const activeTasks = processManager.getActiveTasks();

    reply.send({
      activeTasks,
      count: activeTasks.length
    });
  });

  /**
   * Stop a running task
   */
  fastify.delete('/v1/tasks/:taskId', {
    schema: {
      description: 'Stop a running task by sending SIGTERM to its process',
      tags: ['tasks'],
      params: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'UUID of the task to stop' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            taskId: { type: 'string' },
            status: { type: 'string' },
            message: { type: 'string' }
          }
        },
        404: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            message: { type: 'string' }
          }
        },
        409: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            message: { type: 'string' },
            currentStatus: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { taskId } = request.params;

    logger.info({ taskId }, 'Stopping task');

    const success = processManager.stopTask(taskId);

    if (success === false) {
      const status = processManager.getTaskStatus(taskId);

      if (!status) {
        return reply.code(404).send({
          error: 'Not Found',
          message: `Task ${taskId} not found`
        });
      }

      return reply.code(409).send({
        error: 'Conflict',
        message: `Task ${taskId} cannot be stopped`,
        currentStatus: status.status
      });
    }

    reply.send({
      taskId,
      status: 'stopped',
      message: 'Task stop signal sent successfully'
    });
  });

  /**
   * Stream task logs in real-time using Server-Sent Events (SSE)
   */
  fastify.get('/v1/tasks/:taskId/logs/stream', {
    schema: {
      description: 'Stream task logs in real-time using Server-Sent Events',
      tags: ['tasks', 'logs'],
      params: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'UUID of the task' }
        }
      },
      response: {
        404: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            message: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { taskId } = request.params;

    logger.info({ taskId }, 'Starting log stream');

    // Check if task exists
    const status = processManager.getTaskStatus(taskId);
    if (!status) {
      return reply.code(404).send({
        error: 'Not Found',
        message: `Task ${taskId} not found`
      });
    }

    // Set up SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no' // Disable nginx buffering
    });

    // Send initial log content
    const logStream = processManager.getLogStream(taskId);
    if (logStream) {
      let buffer = '';

      logStream.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep incomplete line in buffer

        lines.forEach(line => {
          if (line.trim()) {
            reply.raw.write(`data: ${JSON.stringify({ line, timestamp: Date.now() })}\n\n`);
          }
        });
      });

      await new Promise((resolve) => {
        logStream.on('end', resolve);
      });

      // Send remaining buffer
      if (buffer.trim()) {
        reply.raw.write(`data: ${JSON.stringify({ line: buffer, timestamp: Date.now() })}\n\n`);
      }
    }

    // Watch for new log entries
    const watcher = processManager.watchLogFile(taskId, (newContent) => {
      const lines = newContent.split('\n');
      lines.forEach(line => {
        if (line.trim()) {
          reply.raw.write(`data: ${JSON.stringify({ line, timestamp: Date.now() })}\n\n`);
        }
      });
    });

    if (!watcher) {
      reply.raw.write(`event: error\ndata: ${JSON.stringify({ message: 'Failed to watch log file' })}\n\n`);
      reply.raw.end();
      return;
    }

    // Send heartbeat every 30 seconds
    const heartbeat = setInterval(() => {
      reply.raw.write(': heartbeat\n\n');
    }, 30000);

    // Check task status periodically and close stream when task completes
    const statusCheck = setInterval(() => {
      const currentStatus = processManager.getTaskStatus(taskId);
      if (currentStatus && currentStatus.status !== 'running') {
        reply.raw.write(`event: task-complete\ndata: ${JSON.stringify({
          status: currentStatus.status,
          exitCode: currentStatus.exitCode,
          timestamp: Date.now()
        })}\n\n`);

        clearInterval(heartbeat);
        clearInterval(statusCheck);
        watcher.close();
        reply.raw.end();
      }
    }, 5000);

    // Cleanup on client disconnect
    request.raw.on('close', () => {
      logger.info({ taskId }, 'Log stream client disconnected');
      clearInterval(heartbeat);
      clearInterval(statusCheck);
      if (watcher) {
        watcher.close();
      }
    });
  });
}

module.exports = tasksRoutes;
