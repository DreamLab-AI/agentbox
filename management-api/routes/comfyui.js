/**
 * ComfyUI workflow management routes
 * Integrates with existing Management API architecture
 */

async function comfyuiRoutes(fastify, options) {
  const { logger, metrics, comfyuiManager } = options;

  /**
   * Submit workflow for execution
   */
  fastify.post('/v1/comfyui/workflow', {
    schema: {
      description: 'Submit a ComfyUI workflow for execution',
      tags: ['comfyui'],
      body: {
        type: 'object',
        required: ['workflow'],
        properties: {
          workflow: {
            type: 'object',
            description: 'ComfyUI workflow JSON'
          },
          priority: {
            type: 'string',
            enum: ['low', 'normal', 'high'],
            default: 'normal'
          },
          gpu: {
            type: 'string',
            enum: ['local', 'salad'],
            default: 'local'
          }
        }
      },
      response: {
        202: {
          type: 'object',
          properties: {
            workflowId: { type: 'string' },
            status: { type: 'string' },
            queuePosition: { type: 'number' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { workflow, priority, gpu } = request.body;

    logger.info({ priority, gpu }, 'Submitting ComfyUI workflow');

    try {
      const result = await comfyuiManager.submitWorkflow(workflow, { priority, gpu });

      reply.code(202).send({
        workflowId: result.workflowId,
        status: 'queued',
        queuePosition: result.queuePosition
      });
    } catch (error) {
      logger.error({ error: error.message }, 'Failed to submit workflow');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: error.message
      });
    }
  });

  /**
   * Get workflow status
   */
  fastify.get('/v1/comfyui/workflow/:workflowId', {
    schema: {
      description: 'Get workflow execution status',
      tags: ['comfyui'],
      params: {
        type: 'object',
        properties: {
          workflowId: { type: 'string' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            workflowId: { type: 'string' },
            status: { type: 'string' },
            progress: { type: 'number' },
            currentNode: { type: 'string' },
            startTime: { type: 'number' },
            completionTime: { type: ['number', 'null'] },
            outputs: { type: 'array' },
            error: { type: ['string', 'null'] }
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
    const { workflowId } = request.params;

    const status = await comfyuiManager.getWorkflowStatus(workflowId);

    if (!status) {
      return reply.code(404).send({
        error: 'Not Found',
        message: `Workflow ${workflowId} not found`
      });
    }

    reply.send(status);
  });

  /**
   * List available models
   */
  fastify.get('/v1/comfyui/models', {
    schema: {
      description: 'List available ComfyUI models',
      tags: ['comfyui'],
      querystring: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['checkpoints', 'loras', 'vae', 'controlnet', 'upscale']
          }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            models: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  type: { type: 'string' },
                  size: { type: 'number' },
                  hash: { type: 'string' }
                }
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { type } = request.query;

    const models = await comfyuiManager.listModels(type);

    reply.send({ models });
  });

  /**
   * List workflow outputs
   */
  fastify.get('/v1/comfyui/outputs', {
    schema: {
      description: 'List generated outputs',
      tags: ['comfyui'],
      querystring: {
        type: 'object',
        properties: {
          workflowId: { type: 'string' },
          limit: { type: 'number', default: 50 }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            outputs: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  filename: { type: 'string' },
                  workflowId: { type: 'string' },
                  type: { type: 'string' },
                  size: { type: 'number' },
                  createdAt: { type: 'number' },
                  url: { type: 'string' }
                }
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { workflowId, limit } = request.query;

    const outputs = await comfyuiManager.listOutputs({ workflowId, limit });

    reply.send({ outputs });
  });

  /**
   * Cancel workflow
   */
  fastify.delete('/v1/comfyui/workflow/:workflowId', {
    schema: {
      description: 'Cancel a running or queued workflow',
      tags: ['comfyui'],
      params: {
        type: 'object',
        properties: {
          workflowId: { type: 'string' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            workflowId: { type: 'string' },
            status: { type: 'string' }
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
    const { workflowId } = request.params;

    logger.info({ workflowId }, 'Cancelling workflow');

    const success = await comfyuiManager.cancelWorkflow(workflowId);

    if (!success) {
      const status = await comfyuiManager.getWorkflowStatus(workflowId);

      if (!status) {
        return reply.code(404).send({
          error: 'Not Found',
          message: `Workflow ${workflowId} not found`
        });
      }

      return reply.code(409).send({
        error: 'Conflict',
        message: 'Workflow cannot be cancelled',
        currentStatus: status.status
      });
    }

    reply.send({
      workflowId,
      status: 'cancelled'
    });
  });

  /**
   * WebSocket for real-time updates
   */
  fastify.get('/v1/comfyui/stream', { websocket: true }, (connection, request) => {
    const clientId = Date.now().toString();
    logger.info({ clientId }, 'WebSocket client connected');

    // Subscribe to workflow events
    const unsubscribe = comfyuiManager.subscribe((event) => {
      try {
        connection.socket.send(JSON.stringify(event));
      } catch (error) {
        logger.error({ error: error.message }, 'Failed to send WebSocket message');
      }
    });

    connection.socket.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());

        // Handle ping/pong
        if (data.type === 'ping') {
          connection.socket.send(JSON.stringify({ type: 'pong' }));
        }

        // Handle workflow subscription
        if (data.type === 'subscribe' && data.workflowId) {
          comfyuiManager.subscribeToWorkflow(data.workflowId, clientId);
        }

        if (data.type === 'unsubscribe' && data.workflowId) {
          comfyuiManager.unsubscribeFromWorkflow(data.workflowId, clientId);
        }
      } catch (error) {
        logger.error({ error: error.message }, 'Failed to parse WebSocket message');
      }
    });

    connection.socket.on('close', () => {
      logger.info({ clientId }, 'WebSocket client disconnected');
      unsubscribe();
    });
  });
}

module.exports = comfyuiRoutes;
