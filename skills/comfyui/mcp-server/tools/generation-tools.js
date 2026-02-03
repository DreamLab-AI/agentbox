/**
 * Generation Convenience Tools
 * High-level wrappers for image and video generation
 */

const path = require('path');

module.exports = function(server, services) {
  const { comfyui, logger } = services;

  server.setRequestHandler('tools/call', async (request) => {
    const { name, arguments: args } = request.params;

    try {
      // Image Generate
      if (name === 'image_generate') {
        const {
          prompt,
          negative_prompt = '',
          model = 'sd_xl_base_1.0.safetensors',
          width = 1024,
          height = 1024,
          steps = 20,
          cfg_scale = 7.0,
          sampler = 'euler',
          scheduler = 'normal',
          seed = -1,
          batch_size = 1
        } = args;

        if (!prompt) {
          throw new Error('prompt is required');
        }

        logger.info('Generating image', { prompt: prompt.substring(0, 50) });

        // Build workflow using template
        const workflow = {
          prompt: {
            "3": {
              inputs: {
                seed: seed === -1 ? Math.floor(Math.random() * 1000000000) : seed,
                steps,
                cfg: cfg_scale,
                sampler_name: sampler,
                scheduler,
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
              inputs: {
                width,
                height,
                batch_size
              },
              class_type: "EmptyLatentImage"
            },
            "6": {
              inputs: {
                text: prompt,
                clip: ["4", 1]
              },
              class_type: "CLIPTextEncode"
            },
            "7": {
              inputs: {
                text: negative_prompt,
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

        const result = await comfyui.submitPrompt(workflow);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              prompt_id: result.prompt_id,
              number: result.number,
              parameters: {
                prompt,
                model,
                width,
                height,
                steps,
                cfg_scale,
                seed: workflow.prompt["3"].inputs.seed
              },
              message: 'Image generation started'
            }, null, 2)
          }]
        };
      }

      // Video Generate
      if (name === 'video_generate') {
        const {
          prompt,
          negative_prompt = '',
          frames = 16,
          fps = 8,
          width = 512,
          height = 512,
          steps = 20,
          cfg_scale = 7.0,
          motion_bucket_id = 127,
          seed = -1
        } = args;

        if (!prompt) {
          throw new Error('prompt is required');
        }

        logger.info('Generating video', { prompt: prompt.substring(0, 50), frames });

        // Build SVD workflow
        const workflow = {
          prompt: {
            "1": {
              inputs: {
                ckpt_name: "svd_xt_1_1.safetensors"
              },
              class_type: "ImageOnlyCheckpointLoader"
            },
            "2": {
              inputs: {
                width,
                height,
                video_frames: frames,
                motion_bucket_id,
                fps,
                augmentation_level: 0,
                clip_vision: ["1", 1],
                init_image: ["3", 0],
                vae: ["1", 2]
              },
              class_type: "SVD_img2vid_Conditioning"
            },
            "3": {
              inputs: {
                text: prompt,
                clip: ["1", 0]
              },
              class_type: "CLIPTextEncode"
            },
            "4": {
              inputs: {
                seed: seed === -1 ? Math.floor(Math.random() * 1000000000) : seed,
                steps,
                cfg: cfg_scale,
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
                fps,
                images: ["5", 0]
              },
              class_type: "VHS_VideoCombine"
            }
          }
        };

        const result = await comfyui.submitPrompt(workflow);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              prompt_id: result.prompt_id,
              number: result.number,
              parameters: {
                prompt,
                frames,
                fps,
                width,
                height,
                steps,
                seed: workflow.prompt["4"].inputs.seed
              },
              message: 'Video generation started'
            }, null, 2)
          }]
        };
      }

    } catch (error) {
      logger.error('Generation tool error', { name, error: error.message });
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
