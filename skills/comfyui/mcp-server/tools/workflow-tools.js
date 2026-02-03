/**
 * Workflow Management Tools
 * Handles workflow submission, status checking, and cancellation
 */

module.exports = function(server, services) {
  const { comfyui, logger } = services;

  server.setRequestHandler('tools/call', async (request) => {
    const { name, arguments: args } = request.params;

    try {
      // Workflow Submit
      if (name === 'workflow_submit') {
        const { workflow, priority = 'normal' } = args;

        if (!workflow) {
          throw new Error('Workflow is required');
        }

        // Validate workflow structure
        if (typeof workflow !== 'object' || !workflow.prompt) {
          throw new Error('Invalid workflow format. Must contain "prompt" object');
        }

        logger.info('Submitting workflow', { priority });
        const result = await comfyui.submitPrompt(workflow, { priority });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              prompt_id: result.prompt_id,
              number: result.number,
              priority,
              message: 'Workflow submitted successfully'
            }, null, 2)
          }]
        };
      }

      // Workflow Status
      if (name === 'workflow_status') {
        const { prompt_id } = args;

        if (!prompt_id) {
          throw new Error('prompt_id is required');
        }

        logger.info('Checking workflow status', { prompt_id });
        const status = await comfyui.getHistory(prompt_id);

        if (!status || Object.keys(status).length === 0) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                prompt_id,
                status: 'pending',
                message: 'Workflow is queued or in progress'
              }, null, 2)
            }]
          };
        }

        const historyItem = status[prompt_id];
        const outputs = historyItem?.outputs || {};
        const hasOutputs = Object.keys(outputs).length > 0;

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              prompt_id,
              status: hasOutputs ? 'completed' : 'processing',
              outputs: outputs,
              message: hasOutputs ? 'Workflow completed' : 'Workflow is processing'
            }, null, 2)
          }]
        };
      }

      // Workflow Cancel
      if (name === 'workflow_cancel') {
        const { prompt_id } = args;

        if (!prompt_id) {
          throw new Error('prompt_id is required');
        }

        logger.info('Cancelling workflow', { prompt_id });

        // ComfyUI doesn't have a direct cancel endpoint, but we can interrupt
        await comfyui.interrupt();

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              prompt_id,
              message: 'Interrupt signal sent. Current workflow will be cancelled.'
            }, null, 2)
          }]
        };
      }

    } catch (error) {
      logger.error('Workflow tool error', { name, error: error.message });
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
