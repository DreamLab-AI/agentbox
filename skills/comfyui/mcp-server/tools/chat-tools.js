/**
 * Chat-Based Workflow Tools
 * LLM-powered workflow generation and interaction
 */

module.exports = function(server, services) {
  const { comfyui, logger } = services;

  server.setRequestHandler('tools/call', async (request) => {
    const { name, arguments: args } = request.params;

    try {
      // Chat Workflow
      if (name === 'chat_workflow') {
        const {
          message,
          context = {},
          auto_execute = false
        } = args;

        if (!message) {
          throw new Error('message is required');
        }

        logger.info('Processing chat workflow', { message: message.substring(0, 50) });

        // Parse intent from message
        const intent = parseIntent(message);
        const workflow = generateWorkflowFromIntent(intent, context);

        if (!workflow) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: 'Could not generate workflow from message',
                message,
                suggestion: 'Try being more specific about what you want to generate'
              }, null, 2)
            }]
          };
        }

        // Auto-execute if requested
        if (auto_execute) {
          const result = await comfyui.submitPrompt(workflow);

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                intent: intent.type,
                prompt_id: result.prompt_id,
                number: result.number,
                workflow,
                message: `Workflow generated and submitted for: ${intent.description}`
              }, null, 2)
            }]
          };
        } else {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                intent: intent.type,
                workflow,
                message: `Workflow generated for: ${intent.description}. Use workflow_submit to execute.`
              }, null, 2)
            }]
          };
        }
      }

    } catch (error) {
      logger.error('Chat tool error', { name, error: error.message });
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

/**
 * Parse intent from natural language message
 */
function parseIntent(message) {
  const lowerMessage = message.toLowerCase();

  // Image generation patterns
  if (lowerMessage.includes('generate') || lowerMessage.includes('create') || lowerMessage.includes('make')) {
    if (lowerMessage.includes('image') || lowerMessage.includes('picture') || lowerMessage.includes('photo')) {
      return {
        type: 'image_generation',
        description: 'Generate an image',
        prompt: extractPrompt(message)
      };
    }

    if (lowerMessage.includes('video') || lowerMessage.includes('animation')) {
      return {
        type: 'video_generation',
        description: 'Generate a video',
        prompt: extractPrompt(message)
      };
    }
  }

  // Upscaling patterns
  if (lowerMessage.includes('upscale') || lowerMessage.includes('enhance') || lowerMessage.includes('improve quality')) {
    return {
      type: 'upscale',
      description: 'Upscale an image',
      prompt: extractPrompt(message)
    };
  }

  // Style transfer patterns
  if (lowerMessage.includes('style') && (lowerMessage.includes('transfer') || lowerMessage.includes('apply'))) {
    return {
      type: 'style_transfer',
      description: 'Apply style transfer',
      prompt: extractPrompt(message)
    };
  }

  // Default to image generation
  return {
    type: 'image_generation',
    description: 'Generate an image',
    prompt: extractPrompt(message)
  };
}

/**
 * Extract prompt from message
 */
function extractPrompt(message) {
  // Remove command words
  let prompt = message.replace(/(generate|create|make|image|video|picture|photo|of|a|an|the)\s+/gi, '');

  // Clean up
  prompt = prompt.trim();

  // If prompt is still too short, use original message
  if (prompt.length < 10) {
    prompt = message;
  }

  return prompt;
}

/**
 * Generate ComfyUI workflow from parsed intent
 */
function generateWorkflowFromIntent(intent, context) {
  const {
    model = 'sd_xl_base_1.0.safetensors',
    width = 1024,
    height = 1024,
    steps = 20,
    cfg_scale = 7.0,
    seed = -1
  } = context;

  const actualSeed = seed === -1 ? Math.floor(Math.random() * 1000000000) : seed;

  switch (intent.type) {
    case 'image_generation':
      return {
        prompt: {
          "3": {
            inputs: {
              seed: actualSeed,
              steps,
              cfg: cfg_scale,
              sampler_name: "euler",
              scheduler: "normal",
              denoise: 1,
              model: ["4", 0],
              positive: ["6", 0],
              negative: ["7", 0],
              latent_image: ["5", 0]
            },
            class_type: "KSampler"
          },
          "4": {
            inputs: { ckpt_name: model },
            class_type: "CheckpointLoaderSimple"
          },
          "5": {
            inputs: { width, height, batch_size: 1 },
            class_type: "EmptyLatentImage"
          },
          "6": {
            inputs: {
              text: intent.prompt,
              clip: ["4", 1]
            },
            class_type: "CLIPTextEncode"
          },
          "7": {
            inputs: {
              text: "low quality, blurry, distorted",
              clip: ["4", 1]
            },
            class_type: "CLIPTextEncode"
          },
          "8": {
            inputs: {
              samples: ["3", 0],
              vae: ["4", 2]
            },
            class_type: "VAEDecode"
          },
          "9": {
            inputs: {
              filename_prefix: "ComfyUI",
              images: ["8", 0]
            },
            class_type: "SaveImage"
          }
        }
      };

    case 'video_generation':
      return {
        prompt: {
          "1": {
            inputs: { ckpt_name: "svd_xt_1_1.safetensors" },
            class_type: "ImageOnlyCheckpointLoader"
          },
          "2": {
            inputs: {
              width: 512,
              height: 512,
              video_frames: 16,
              motion_bucket_id: 127,
              fps: 8,
              augmentation_level: 0,
              clip_vision: ["1", 1],
              init_image: ["3", 0],
              vae: ["1", 2]
            },
            class_type: "SVD_img2vid_Conditioning"
          },
          "3": {
            inputs: {
              text: intent.prompt,
              clip: ["1", 0]
            },
            class_type: "CLIPTextEncode"
          },
          "4": {
            inputs: {
              seed: actualSeed,
              steps: 20,
              cfg: 2.5,
              sampler_name: "euler",
              scheduler: "normal",
              denoise: 1,
              model: ["1", 0],
              positive: ["2", 0],
              negative: ["2", 1],
              latent_image: ["2", 2]
            },
            class_type: "KSampler"
          },
          "5": {
            inputs: {
              samples: ["4", 0],
              vae: ["1", 2]
            },
            class_type: "VAEDecode"
          },
          "6": {
            inputs: {
              filename_prefix: "ComfyUI_video",
              fps: 8,
              images: ["5", 0]
            },
            class_type: "VHS_VideoCombine"
          }
        }
      };

    default:
      return null;
  }
}
