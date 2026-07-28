# ComfyUI Workflow JSON Structures & Supported Models

## FLUX 2 workflow (recommended)

Uses separate loaders for UNET, CLIP, and VAE with `SamplerCustomAdvanced`:

```json
{
  "68": {"inputs": {"model": ["86", 0], "conditioning": ["73", 0]}, "class_type": "BasicGuider"},
  "73": {"inputs": {"guidance": 4, "conditioning": ["85", 0]}, "class_type": "FluxGuidance"},
  "74": {"inputs": {"sampler_name": "euler"}, "class_type": "KSamplerSelect"},
  "78": {"inputs": {"vae_name": "flux2-vae.safetensors"}, "class_type": "VAELoader"},
  "79": {"inputs": {"width": 1024, "height": 768, "batch_size": 1}, "class_type": "EmptyFlux2LatentImage"},
  "80": {"inputs": {"noise": ["87", 0], "guider": ["68", 0], "sampler": ["74", 0], "sigmas": ["94", 0], "latent_image": ["79", 0]}, "class_type": "SamplerCustomAdvanced"},
  "82": {"inputs": {"samples": ["80", 0], "vae": ["78", 0]}, "class_type": "VAEDecode"},
  "85": {"inputs": {"text": ["93", 0], "clip": ["90", 0]}, "class_type": "CLIPTextEncode"},
  "86": {"inputs": {"unet_name": "flux2_dev_fp8mixed.safetensors", "weight_dtype": "default"}, "class_type": "UNETLoader"},
  "87": {"inputs": {"noise_seed": 42}, "class_type": "RandomNoise"},
  "89": {"inputs": {"filename_prefix": "Output", "images": ["82", 0]}, "class_type": "SaveImage"},
  "90": {"inputs": {"clip_name": "mistral_3_small_flux2_bf16.safetensors", "type": "flux2", "device": "default"}, "class_type": "CLIPLoader"},
  "93": {"inputs": {"value": "your prompt here"}, "class_type": "PrimitiveString"},
  "94": {"inputs": {"steps": 25, "width": 1024, "height": 768}, "class_type": "Flux2Scheduler"}
}
```

## Legacy FLUX 1 workflow (CheckpointLoaderSimple)
```json
{
  "6": {
    "inputs": {
      "text": "your prompt here",
      "clip": ["30", 1]
    },
    "class_type": "CLIPTextEncode",
    "_meta": { "title": "CLIP Text Encode (Positive Prompt)" }
  },
  "8": {
    "inputs": {
      "samples": ["31", 0],
      "vae": ["30", 2]
    },
    "class_type": "VAEDecode"
  },
  "9": {
    "inputs": {
      "filename_prefix": "ComfyUI",
      "images": ["8", 0]
    },
    "class_type": "SaveImage"
  },
  "27": {
    "inputs": {
      "width": 1024,
      "height": 1024,
      "batch_size": 1
    },
    "class_type": "EmptySD3LatentImage"
  },
  "30": {
    "inputs": {
      "ckpt_name": "flux1-dev-fp8.safetensors"
    },
    "class_type": "CheckpointLoaderSimple"
  },
  "31": {
    "inputs": {
      "seed": 793373912447585,
      "steps": 20,
      "cfg": 1,
      "sampler_name": "euler",
      "scheduler": "simple",
      "denoise": 1,
      "model": ["30", 0],
      "positive": ["35", 0],
      "negative": ["33", 0],
      "latent_image": ["27", 0]
    },
    "class_type": "KSampler"
  },
  "33": {
    "inputs": {
      "text": "",
      "clip": ["30", 1]
    },
    "class_type": "CLIPTextEncode"
  },
  "35": {
    "inputs": {
      "guidance": 3.5,
      "conditioning": ["6", 0]
    },
    "class_type": "FluxGuidance"
  }
}
```

Two working sample workflows also ship alongside this skill:
`../anima_workflow.json` and `../anima_import_workflow.json`
(driven by `../generate_anima.py`).

## Supported models

### Image generation
- FLUX.1-Dev (FP8) - High quality, text generation, non-commercial
- FLUX.1-Schnell (FP8) - Fast generation
- Stable Diffusion 3.5 Large/Medium
- SDXL with Refiner
- DreamShaper 8

### Video generation
- AnimateDiff
- CogVideoX-2B
- HunyuanVideo (FP16)
- LTX-Video
- Mochi Video (FP8)
- Cosmos 1.0 (Text2World)
- WAN 2.1 (I2V 720p)

## Batch generation with Python

```python
import requests
import base64

def generate_image(prompt, output_path, **kwargs):
    response = requests.post(
        "http://localhost:8188/workflow/text2img",
        json={
            "input": {
                "prompt": prompt,
                "width": kwargs.get("width", 1024),
                "height": kwargs.get("height", 1024),
                "steps": kwargs.get("steps", 20),
                "seed": kwargs.get("seed", -1),
            }
        }
    )
    data = response.json()
    if "images" in data:
        image_data = base64.b64decode(data["images"][0])
        with open(output_path, "wb") as f:
            f.write(image_data)
        return True
    return False

# Generate multiple images
prompts = [
    "A serene Japanese garden at sunset",
    "Cyberpunk cityscape with neon lights",
    "Portrait of an astronaut on Mars"
]

for i, prompt in enumerate(prompts):
    generate_image(prompt, f"output_{i}.png")
```
