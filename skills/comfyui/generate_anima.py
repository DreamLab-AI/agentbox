#!/usr/bin/env python3
"""
Anima Model Image Generator for ComfyUI
Generates anime-style images using the circlestone-labs/Anima model.

Usage: python generate_anima.py "your prompt here" [output.png]

Settings:
- Resolution: ~1MP (896x1152, 1024x1024, 1152x896)
- Steps: 30-50
- CFG: 4-5
- Sampler: er_sde (default), euler_a, dpmpp_2m_sde_gpu
"""
import json
import time
import sys
import random
import urllib.request
import urllib.error

COMFYUI_URL = "http://comfyui:8188"  # Docker network hostname

def generate_anima(
    prompt: str,
    output_path: str = "output.png",
    negative_prompt: str = "worst quality, low quality, score_1, score_2, score_3, blurry, jpeg artifacts",
    width: int = 896,
    height: int = 1152,
    steps: int = 30,
    cfg: float = 4.0,
    sampler: str = "er_sde",
    scheduler: str = "simple",
    seed: int = None,
    shift: float = 3.0
) -> str:
    """Generate anime image using Anima model."""

    if seed is None:
        seed = random.randint(0, 2**53)

    workflow = {
        "3": {
            "inputs": {
                "text": negative_prompt,
                "clip": ["70", 0]
            },
            "class_type": "CLIPTextEncode"
        },
        "4": {
            "inputs": {
                "text": prompt,
                "clip": ["70", 0]
            },
            "class_type": "CLIPTextEncode"
        },
        "29": {
            "inputs": {
                "vae_name": "qwen_image_vae.safetensors"
            },
            "class_type": "VAELoader"
        },
        "57": {
            "inputs": {
                "shift": shift,
                "model": ["67", 0]
            },
            "class_type": "ModelSamplingAuraFlow"
        },
        "63": {
            "inputs": {
                "seed": seed,
                "steps": steps,
                "cfg": cfg,
                "sampler_name": sampler,
                "scheduler": scheduler,
                "denoise": 1,
                "model": ["57", 0],
                "positive": ["4", 0],
                "negative": ["3", 0],
                "latent_image": ["75", 0]
            },
            "class_type": "KSampler"
        },
        "66": {
            "inputs": {
                "samples": ["63", 0],
                "vae": ["29", 0]
            },
            "class_type": "VAEDecode"
        },
        "67": {
            "inputs": {
                "unet_name": "anima-preview.safetensors",
                "weight_dtype": "default"
            },
            "class_type": "UNETLoader"
        },
        "70": {
            "inputs": {
                "clip_name": "qwen_3_06b_base.safetensors",
                "type": "stable_diffusion",
                "device": "default"
            },
            "class_type": "CLIPLoader"
        },
        "75": {
            "inputs": {
                "width": width,
                "height": height,
                "batch_size": 1
            },
            "class_type": "EmptyLatentImage"
        },
        "90": {
            "inputs": {
                "filename_prefix": "Anima",
                "images": ["66", 0]
            },
            "class_type": "SaveImage"
        }
    }

    # Submit workflow
    data = json.dumps({"prompt": workflow}).encode()
    req = urllib.request.Request(
        f"{COMFYUI_URL}/prompt",
        data=data,
        headers={"Content-Type": "application/json"}
    )

    try:
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read())
        prompt_id = result["prompt_id"]
        print(f"Submitted: {prompt_id}")
        print(f"Prompt: {prompt[:80]}...")
        print(f"Settings: {width}x{height}, {steps} steps, CFG {cfg}, {sampler}")
    except urllib.error.URLError as e:
        raise RuntimeError(f"Failed to submit workflow: {e}")

    # Wait for completion
    print("Generating...", end="", flush=True)
    while True:
        try:
            with urllib.request.urlopen(f"{COMFYUI_URL}/history/{prompt_id}") as resp:
                history = json.loads(resp.read())
        except urllib.error.URLError:
            print(".", end="", flush=True)
            time.sleep(2)
            continue

        data = history.get(prompt_id, {})
        status = data.get("status", {}).get("status_str", "pending")

        if status == "success":
            print(" Done!")
            outputs = data.get("outputs", {})
            for node_out in outputs.values():
                if "images" in node_out:
                    filename = node_out["images"][0]["filename"]
                    # Download image
                    img_url = f"{COMFYUI_URL}/view?filename={filename}&type=output"
                    urllib.request.urlretrieve(img_url, output_path)
                    print(f"Saved: {output_path}")
                    return output_path
        elif status == "error":
            print(" Failed!")
            error_msg = data.get("status", {}).get("messages", [])
            raise RuntimeError(f"Generation failed: {error_msg}")

        print(".", end="", flush=True)
        time.sleep(2)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python generate_anima.py \"prompt\" [output.png]")
        print("\nExample prompts:")
        print('  "masterpiece, 1girl, purple hair, black robe, simple background"')
        print('  "landscape, sunset, mountains, anime style, detailed background"')
        sys.exit(1)

    prompt = sys.argv[1]
    output = sys.argv[2] if len(sys.argv) > 2 else "anima_output.png"

    generate_anima(prompt, output)
