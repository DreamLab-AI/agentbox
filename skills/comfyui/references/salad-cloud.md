# Salad Cloud Deployment & Distributed Compute

Deploy ComfyUI to Salad Cloud for distributed GPU compute at scale.

## Initialize Salad SDK
```python
import os
from salad_cloud_sdk import SaladCloudSdk

sdk = SaladCloudSdk(api_key=os.environ['SALAD_API_KEY'])
org_name = os.environ.get('SALAD_ORG_NAME', 'default-org')
```

## List GPU classes
```python
gpu_classes = sdk.organization_data.list_gpu_classes(organization_name=org_name)
for gpu in gpu_classes.items:
    print(f"{gpu.name}: {gpu.display_name}")
```

## Create ComfyUI container group
```python
from salad_cloud_sdk.models import (
    CreateContainerGroup,
    ContainerGroupPriority,
    ContainerResourceRequirements,
    CountryCode,
)

container_group = CreateContainerGroup(
    name="comfyui-worker",
    display_name="ComfyUI Worker",
    container=ContainerResourceRequirements(
        image="ghcr.io/comfyanonymous/comfyui:latest",
        resources={
            "cpu": 4,
            "memory": 30720,  # 30GB RAM recommended
            "gpu_classes": ["rtx_4090", "rtx_3090", "a100"]
        },
        environment_variables={
            "COMFYUI_LISTEN": "0.0.0.0",
            "COMFYUI_PORT": "8188"
        }
    ),
    replicas=3,  # Minimum 3 for production
    priority=ContainerGroupPriority.MEDIUM,
    country_codes=[CountryCode.US, CountryCode.CA, CountryCode.GB],
    networking={
        "protocol": "http",
        "port": 8188,
        "auth": False
    }
)

result = sdk.container_groups.create_container_group(
    organization_name=org_name,
    project_name="default",
    request_body=container_group
)
```

## Get quotas
```python
quotas = sdk.quotas.get_quotas(organization_name=org_name)
print(f"Max container groups: {quotas.container_groups_quotas.max_created_container_groups}")
```

## List inference endpoints
```python
endpoints = sdk.inference_endpoints.list_inference_endpoints(
    organization_name=org_name,
    project_name="default"
)
```

## Production deployment example
```python
import os
from salad_cloud_sdk import SaladCloudSdk

sdk = SaladCloudSdk(api_key=os.environ['SALAD_API_KEY'])

# Deploy with recommended production settings
container_config = {
    "name": "flux-production",
    "replicas": 5,  # Over-provision for reliability
    "resources": {
        "cpu": 4,
        "memory": 30720,
        "gpu_classes": ["rtx_4090"]  # 24GB VRAM recommended
    }
}
```

## Salad recipes reference

All recipes available at `/home/devuser/salad-recipes/src/`:

### Image generation recipes
| Recipe | Model | Workflow | Container Config |
|--------|-------|----------|------------------|
| flux1-dev-fp8-comfyui | FLUX.1-Dev FP8 | workflow.json | container-group.json |
| flux1-schnell-fp8-comfyui | FLUX.1-Schnell FP8 | workflow.json | container-group.json |
| flux1-dev-lora-comfyui | FLUX.1-Dev + LoRA | workflow.json | container-group.json |
| sd3.5-large-comfyui | SD 3.5 Large | workflow.json | container-group.json |
| sd3.5-medium-comfyui | SD 3.5 Medium | workflow.json | container-group.json |
| sdxl-with-refiner-comfyui | SDXL + Refiner | workflow.json | container-group.json |
| dreamshaper8-comfyui | DreamShaper 8 | workflow.json | container-group.json |

### Video generation recipes
| Recipe | Model | Workflow | Notes |
|--------|-------|----------|-------|
| animatediff-comfyui | AnimateDiff | workflow.json | Animation from images |
| cogvideox-2b-comfyui | CogVideoX 2B | - | Text-to-video |
| hunyuanvideo-fp16-comfyui | HunyuanVideo FP16 | - | High quality video |
| ltx-video-2b-v0.9.1-comfyui | LTX-Video 2B | workflow.json | Fast video generation |
| mochi-video-fp8-comfyui | Mochi Video FP8 | - | Efficient video |
| cosmos1.0-7b-text2world-comfyui | Cosmos Text2World | workflow.json | World generation |
| wan2.1-i2v-720p-comfyui | WAN 2.1 I2V | prompt.json | Image-to-video 720p |

### LLM recipes (Text Generation Inference)
| Recipe | Model | Container Config |
|--------|-------|------------------|
| tgi-llama-3.1-8b-instruct | Llama 3.1 8B | container-group.json |
| tgi-llama-3.2-11b-vision-instruct | Llama 3.2 Vision 11B | container-group.json |
| tgi-mistral-7b | Mistral 7B | container-group.json |
| tgi-nemo-12b-instruct-fp8 | Nemo 12B FP8 | container-group.json |
| tgi-qwen2.5-vl-3b-instruct | Qwen 2.5 VL 3B | container-group.json |
| tgi-qwen2.5-vl-7b-instruct | Qwen 2.5 VL 7B | container-group.json |
| tgi-qwen3-8b | Qwen 3 8B | container-group.json |
| tgi-lyra-12b-darkness | Lyra 12B | container-group.json |

### Other recipes
| Recipe | Purpose |
|--------|---------|
| yolov8 | Object detection (OpenAPI available) |
| ollama | Local LLM server |
| ollama-llama3.1 | Ollama with Llama 3.1 |
| ubuntu-dev | Development environment |
| hello-world | Template example |
| sogni-flux-worker | Sogni FLUX worker |
| sogni-stable-diffusion-worker | Sogni SD worker |

### Loading recipe workflows
```python
import json

# Load a workflow
with open('/home/devuser/salad-recipes/src/flux1-dev-fp8-comfyui/workflow.json') as f:
    workflow = json.load(f)

# Load container group config for Salad deployment
with open('/home/devuser/salad-recipes/src/flux1-dev-fp8-comfyui/container-group.json') as f:
    container_config = json.load(f)

# Load OpenAPI spec (where available)
with open('/home/devuser/salad-recipes/src/flux1-dev-fp8-comfyui/openapi.json') as f:
    api_spec = json.load(f)
```

### Benchmark data available

Performance benchmarks in `benchmark/` subdirectories:
- `flux1-dev-fp8-comfyui/benchmark/4090.json` - RTX 4090 benchmarks
- `sd3.5-medium-comfyui/benchmark/` - RTX 3090/4090 comparisons
- `ltx-video-2b-v0.9.1-comfyui/benchmark/` - Video generation benchmarks

## Hardware recommendations

| Model | VRAM | System RAM | Notes |
|-------|------|------------|-------|
| FLUX.1-Dev FP8 | 16GB+ | 30GB | RTX 4090 recommended |
| FLUX.1-Schnell | 12GB+ | 24GB | Faster inference |
| SD 3.5 Large | 16GB+ | 24GB | High quality |
| SDXL | 12GB+ | 16GB | Good balance |
| AnimateDiff | 16GB+ | 32GB | Video generation |

## Performance notes

- Image generation (1024x1024): 3-15 seconds on RTX 4090
- Video generation: varies by length and model
- Distributed compute: account for network latency
- Use webhooks for async operations in production

## References
- ComfyUI: https://github.com/comfyanonymous/ComfyUI
- ComfyUI API: https://github.com/SaladTechnologies/comfyui-api
- Salad Recipes: https://github.com/SaladTechnologies/salad-recipes
- Salad Cloud SDK: https://portal.salad.com
- Local Recipes: /home/devuser/salad-recipes/src/
