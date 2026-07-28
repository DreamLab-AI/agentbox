#!/usr/bin/env python3
"""
ComfyUI FLUX 2 Image Generator
Usage: python generate.py "your prompt here" [output.png]

Submits the current FLUX 2 workflow (separate UNET/CLIP/VAE loaders +
SamplerCustomAdvanced) to the external ComfyUI Docker container, polls to
completion, and downloads the result. Uses the `comfyui` Docker network
hostname — not localhost — because this runs from another container.
"""
import json
import time
import sys
import urllib.request
import urllib.error

COMFYUI_URL = "http://comfyui:8188"  # Docker network hostname


def generate_image(prompt: str, output_path: str = "output.png",
                   width: int = 1024, height: int = 768,
                   steps: int = 25, guidance: float = 4.0,
                   seed: int = None) -> str:
    """Generate image using FLUX 2 and save to file."""

    if seed is None:
        import random
        seed = random.randint(0, 2**32)

    workflow = {
        "68": {"inputs": {"model": ["86", 0], "conditioning": ["73", 0]}, "class_type": "BasicGuider"},
        "73": {"inputs": {"guidance": guidance, "conditioning": ["85", 0]}, "class_type": "FluxGuidance"},
        "74": {"inputs": {"sampler_name": "euler"}, "class_type": "KSamplerSelect"},
        "78": {"inputs": {"vae_name": "flux2-vae.safetensors"}, "class_type": "VAELoader"},
        "79": {"inputs": {"width": width, "height": height, "batch_size": 1}, "class_type": "EmptyFlux2LatentImage"},
        "80": {"inputs": {"noise": ["87", 0], "guider": ["68", 0], "sampler": ["74", 0], "sigmas": ["94", 0], "latent_image": ["79", 0]}, "class_type": "SamplerCustomAdvanced"},
        "82": {"inputs": {"samples": ["80", 0], "vae": ["78", 0]}, "class_type": "VAEDecode"},
        "85": {"inputs": {"text": ["93", 0], "clip": ["90", 0]}, "class_type": "CLIPTextEncode"},
        "86": {"inputs": {"unet_name": "flux2_dev_fp8mixed.safetensors", "weight_dtype": "default"}, "class_type": "UNETLoader"},
        "87": {"inputs": {"noise_seed": seed}, "class_type": "RandomNoise"},
        "89": {"inputs": {"filename_prefix": "Generated", "images": ["82", 0]}, "class_type": "SaveImage"},
        "90": {"inputs": {"clip_name": "mistral_3_small_flux2_bf16.safetensors", "type": "flux2", "device": "default"}, "class_type": "CLIPLoader"},
        "93": {"inputs": {"value": prompt}, "class_type": "PrimitiveString"},
        "94": {"inputs": {"steps": steps, "width": width, "height": height}, "class_type": "Flux2Scheduler"}
    }

    # Submit workflow
    data = json.dumps({"prompt": workflow}).encode()
    req = urllib.request.Request(f"{COMFYUI_URL}/prompt", data=data,
                                  headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read())
    prompt_id = result["prompt_id"]
    print(f"Submitted: {prompt_id}")

    # Wait for completion
    while True:
        with urllib.request.urlopen(f"{COMFYUI_URL}/history/{prompt_id}") as resp:
            history = json.loads(resp.read())

        data = history.get(prompt_id, {})
        status = data.get("status", {}).get("status_str", "pending")

        if status == "success":
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
            raise RuntimeError("Generation failed")

        time.sleep(2)


if __name__ == "__main__":
    prompt = sys.argv[1] if len(sys.argv) > 1 else "A beautiful sunset over mountains"
    output = sys.argv[2] if len(sys.argv) > 2 else "output.png"
    generate_image(prompt, output)
