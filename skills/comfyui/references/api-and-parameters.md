# ComfyUI API, Parameters & Local Operations

## Prerequisites

### Local setup
- ComfyUI installed: `/home/devuser/ComfyUI/`
- Python venv: `source /home/devuser/ComfyUI/venv/bin/activate`
- GPU with CUDA support (or `--cpu` flag for testing)
- Default port: 8188

### Distributed (Salad Cloud)
- `SALAD_API_KEY` environment variable
- `SALAD_ORG_NAME` environment variable
- salad-cloud-sdk: `pip install salad-cloud-sdk`

See `salad-cloud.md` for deployment detail.

## Local ComfyUI operations

### Start ComfyUI server
```bash
cd /home/devuser/ComfyUI
source venv/bin/activate
python main.py --listen 0.0.0.0 --port 8188
```

### Start with GPU
```bash
python main.py --listen 0.0.0.0 --port 8188
```

### Start in CPU mode (testing)
```bash
python main.py --listen 0.0.0.0 --port 8188 --cpu
```

## API endpoints

### Health check
```bash
curl http://localhost:8188/health
```

### Ready check
```bash
curl http://localhost:8188/ready
```

### List available models
```bash
curl http://localhost:8188/models
```

### Text to image (simple)
```bash
curl -X POST "http://localhost:8188/workflow/text2img" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "prompt": "A beautiful sunset over the ocean",
      "width": 1024,
      "height": 1024,
      "steps": 20,
      "cfg_scale": 7.5
    }
  }' | jq -r '.images[0]' | base64 -d > image.png
```

### Submit raw ComfyUI prompt
```bash
curl -X POST "http://localhost:8188/prompt" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": {
      "6": {
        "inputs": { "text": "your prompt here", "clip": ["30", 1] },
        "class_type": "CLIPTextEncode"
      },
      ...
    }
  }'
```

## Workflow parameters

### text2img parameters
| Parameter | Type | Default | Range | Description |
|-----------|------|---------|-------|-------------|
| prompt | string | required | - | Positive prompt for image generation |
| width | integer | 1024 | 256-2048 | Image width in pixels |
| height | integer | 1024 | 256-2048 | Image height in pixels |
| seed | integer | random | - | Seed for reproducibility |
| steps | integer | 20 | 1-100 | Number of sampling steps |
| cfg_scale | number | 1.0 | 0-20 | Classifier-free guidance scale |
| sampler_name | string | "euler" | see list | Sampling algorithm |
| scheduler | string | "simple" | see list | Noise scheduler |
| denoise | number | 1.0 | 0-1 | Denoising strength |
| guidance | number | 3.5 | 0-10 | FLUX guidance scale |

### Available samplers
euler, euler_cfg_pp, euler_ancestral, euler_ancestral_cfg_pp, heun, heunpp2, dpm_2, dpm_2_ancestral, lms, dpm_fast, dpm_adaptive, dpmpp_2s_ancestral, dpmpp_2s_ancestral_cfg_pp, dpmpp_sde, dpmpp_sde_gpu, dpmpp_2m, dpmpp_2m_cfg_pp, dpmpp_2m_sde, dpmpp_2m_sde_gpu, dpmpp_3m_sde, dpmpp_3m_sde_gpu, ddpm, lcm, ipndm, ipndm_v, deis, ddim, uni_pc, uni_pc_bh2

### Available schedulers
normal, karras, exponential, sgm_uniform, simple, ddim_uniform, beta, linear_quadratic

## Output conversion

Convert output to JPEG or WebP:
```json
{
  "convert_output": {
    "format": "webp",
    "options": {
      "quality": 85,
      "lossless": false
    }
  }
}
```

## Webhook support

Receive completed images via webhook:
```json
{
  "webhook": "https://your-server.com/webhook",
  "input": { "prompt": "..." }
}
```

## Error handling

Common errors and solutions:
- **CUDA out of memory**: Reduce resolution or batch size
- **Model not found**: Check checkpoint path in models directory
- **Connection refused**: Ensure ComfyUI server is running
- **Timeout**: Increase timeout for large generations

## Files and directories

```
/home/devuser/ComfyUI/
  venv/           # Python virtual environment
  models/         # Model checkpoints
    checkpoints/  # Main models
    loras/        # LoRA adapters
    vae/          # VAE models
  custom_nodes/   # Custom node packages
  input/          # Input images
  output/         # Generated outputs
  scripts/        # Utility scripts
    test_salad_api.py  # Salad SDK test
```
