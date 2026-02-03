/**
 * Model Management Tools
 * Handles model listing and information retrieval
 */

module.exports = function(server, services) {
  const { comfyui, logger } = services;

  server.setRequestHandler('tools/call', async (request) => {
    const { name, arguments: args } = request.params;

    try {
      // Model List
      if (name === 'model_list') {
        const { type = 'all' } = args;

        logger.info('Listing models', { type });
        const models = await comfyui.getModels();

        // Filter by type if specified
        let filteredModels = models;
        if (type !== 'all') {
          filteredModels = models.filter(model => {
            const modelType = model.type || 'unknown';
            return modelType.toLowerCase() === type.toLowerCase();
          });
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              count: filteredModels.length,
              type,
              models: filteredModels.map(model => ({
                name: model.name,
                type: model.type || 'checkpoint',
                path: model.path,
                size: model.size
              }))
            }, null, 2)
          }]
        };
      }

      // Model Info
      if (name === 'model_info') {
        const { model_name } = args;

        if (!model_name) {
          throw new Error('model_name is required');
        }

        logger.info('Getting model info', { model_name });
        const models = await comfyui.getModels();

        const model = models.find(m =>
          m.name === model_name ||
          m.path.includes(model_name)
        );

        if (!model) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: `Model not found: ${model_name}`,
                available_models: models.map(m => m.name).slice(0, 10)
              }, null, 2)
            }]
          };
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              model: {
                name: model.name,
                type: model.type || 'checkpoint',
                path: model.path,
                size: model.size,
                format: model.format || 'safetensors',
                modified: model.modified
              }
            }, null, 2)
          }]
        };
      }

    } catch (error) {
      logger.error('Model tool error', { name, error: error.message });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error.message,
            tool: name
          }, null, 2)
        }],
        isError: true
      };
    }
  });
};
