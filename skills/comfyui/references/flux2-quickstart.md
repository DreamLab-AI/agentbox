# FLUX 2 Quickstart (current pod setup)

The container's live setup runs FLUX 2 with separate UNET/CLIP/VAE loaders and
`SamplerCustomAdvanced`. Everything below assumes the `comfyui` Docker hostname
(see the container-architecture section in `SKILL.md`).

## Step 1: Check ComfyUI is running

```bash
# External Docker container (use comfyui hostname, NOT localhost)
curl -s "http://comfyui:8188/system_stats" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print('ComfyUI:', d['system']['comfyui_version'])
for dev in d.get('devices', []):
    print(f\"GPU: {dev.get('name')} - {dev.get('vram_free',0)//(1024**3)}GB free\")
"
```

## Step 2: Create and submit a FLUX 2 workflow

```bash
# Create workflow JSON
cat > /tmp/flux2_workflow.json << 'EOF'
{
  "68": {
    "inputs": {"model": ["86", 0], "conditioning": ["73", 0]},
    "class_type": "BasicGuider"
  },
  "73": {
    "inputs": {"guidance": 4, "conditioning": ["85", 0]},
    "class_type": "FluxGuidance"
  },
  "74": {
    "inputs": {"sampler_name": "euler"},
    "class_type": "KSamplerSelect"
  },
  "78": {
    "inputs": {"vae_name": "flux2-vae.safetensors"},
    "class_type": "VAELoader"
  },
  "79": {
    "inputs": {"width": 1024, "height": 768, "batch_size": 1},
    "class_type": "EmptyFlux2LatentImage"
  },
  "80": {
    "inputs": {
      "noise": ["87", 0], "guider": ["68", 0],
      "sampler": ["74", 0], "sigmas": ["94", 0],
      "latent_image": ["79", 0]
    },
    "class_type": "SamplerCustomAdvanced"
  },
  "82": {
    "inputs": {"samples": ["80", 0], "vae": ["78", 0]},
    "class_type": "VAEDecode"
  },
  "85": {
    "inputs": {"text": ["93", 0], "clip": ["90", 0]},
    "class_type": "CLIPTextEncode"
  },
  "86": {
    "inputs": {
      "unet_name": "flux2_dev_fp8mixed.safetensors",
      "weight_dtype": "default"
    },
    "class_type": "UNETLoader"
  },
  "87": {
    "inputs": {"noise_seed": 42},
    "class_type": "RandomNoise"
  },
  "89": {
    "inputs": {"filename_prefix": "Generated", "images": ["82", 0]},
    "class_type": "SaveImage"
  },
  "90": {
    "inputs": {
      "clip_name": "mistral_3_small_flux2_bf16.safetensors",
      "type": "flux2",
      "device": "default"
    },
    "class_type": "CLIPLoader"
  },
  "93": {
    "inputs": {"value": "YOUR PROMPT HERE"},
    "class_type": "PrimitiveString"
  },
  "94": {
    "inputs": {"steps": 25, "width": 1024, "height": 768},
    "class_type": "Flux2Scheduler"
  }
}
EOF

# Edit the prompt (node 93)
sed -i 's/YOUR PROMPT HERE/A stunning landscape at golden hour, cinematic lighting/' /tmp/flux2_workflow.json

# Submit workflow
WORKFLOW=$(cat /tmp/flux2_workflow.json)
RESPONSE=$(curl -s -X POST "http://comfyui:8188/prompt" \
  -H "Content-Type: application/json" \
  -d "{\"prompt\": $WORKFLOW}")
PROMPT_ID=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['prompt_id'])")
echo "Submitted: $PROMPT_ID"
```

## Step 3: Monitor generation progress

```bash
# Poll until complete (typically 15-30 seconds for FLUX 2)
while true; do
  curl -s "http://comfyui:8188/history/$PROMPT_ID" > /tmp/hist.json
  STATUS=$(python3 -c "
import json
d=json.load(open('/tmp/hist.json'))
data=d.get('$PROMPT_ID',{})
print(data.get('status',{}).get('status_str','pending'))
")
  echo "Status: $STATUS"
  [ "$STATUS" = "success" ] && break
  [ "$STATUS" = "error" ] && { echo "Failed!"; break; }
  sleep 5
done
```

## Step 4: Download the generated image

```bash
# Get filename from history
FILENAME=$(python3 -c "
import json
d=json.load(open('/tmp/hist.json'))
outputs=d.get('$PROMPT_ID',{}).get('outputs',{})
for nid,out in outputs.items():
    if 'images' in out:
        print(out['images'][0]['filename'])
        break
")

# Download image
curl -s "http://comfyui:8188/view?filename=$FILENAME&type=output" -o ./generated_image.png
echo "Saved: generated_image.png"
```

## One-liner quick generation

```bash
# All-in-one: Generate and download
PROMPT="A dreamlike mountain lake at dawn with fog"
cat > /tmp/wf.json << EOF
{"68":{"inputs":{"model":["86",0],"conditioning":["73",0]},"class_type":"BasicGuider"},"73":{"inputs":{"guidance":4,"conditioning":["85",0]},"class_type":"FluxGuidance"},"74":{"inputs":{"sampler_name":"euler"},"class_type":"KSamplerSelect"},"78":{"inputs":{"vae_name":"flux2-vae.safetensors"},"class_type":"VAELoader"},"79":{"inputs":{"width":1024,"height":768,"batch_size":1},"class_type":"EmptyFlux2LatentImage"},"80":{"inputs":{"noise":["87",0],"guider":["68",0],"sampler":["74",0],"sigmas":["94",0],"latent_image":["79",0]},"class_type":"SamplerCustomAdvanced"},"82":{"inputs":{"samples":["80",0],"vae":["78",0]},"class_type":"VAEDecode"},"85":{"inputs":{"text":["93",0],"clip":["90",0]},"class_type":"CLIPTextEncode"},"86":{"inputs":{"unet_name":"flux2_dev_fp8mixed.safetensors","weight_dtype":"default"},"class_type":"UNETLoader"},"87":{"inputs":{"noise_seed":$RANDOM},"class_type":"RandomNoise"},"89":{"inputs":{"filename_prefix":"Quick","images":["82",0]},"class_type":"SaveImage"},"90":{"inputs":{"clip_name":"mistral_3_small_flux2_bf16.safetensors","type":"flux2","device":"default"},"class_type":"CLIPLoader"},"93":{"inputs":{"value":"$PROMPT"},"class_type":"PrimitiveString"},"94":{"inputs":{"steps":25,"width":1024,"height":768},"class_type":"Flux2Scheduler"}}
EOF
PID=$(curl -s -X POST "http://comfyui:8188/prompt" -H "Content-Type: application/json" -d "{\"prompt\": $(cat /tmp/wf.json)}" | python3 -c "import sys,json;print(json.load(sys.stdin)['prompt_id'])")
echo "Generating... $PID"
sleep 30
FN=$(curl -s "http://comfyui:8188/history/$PID" | python3 -c "import sys,json;d=json.load(sys.stdin);o=d.get('$PID',{}).get('outputs',{});print([i['filename'] for v in o.values() for i in v.get('images',[])][0] if o else '')")
[ -n "$FN" ] && curl -s "http://comfyui:8188/view?filename=$FN&type=output" -o output.png && echo "Saved: output.png"
```

For a reusable Python entry point, use `../generate.py "your prompt" output.png`.

## VRAM management

```bash
# Free GPU memory before generation (if OOM errors)
curl -s -X POST "http://comfyui:8188/free" \
  -H "Content-Type: application/json" \
  -d '{"unload_models": true, "free_memory": true}'
```

## Available models (current setup)

| Component | Model File | Notes |
|-----------|-----------|-------|
| UNET | `flux2_dev_fp8mixed.safetensors` | FLUX 2 Dev FP8 |
| CLIP | `mistral_3_small_flux2_bf16.safetensors` | Mistral 3 Small |
| VAE | `flux2-vae.safetensors` | FLUX 2 VAE |

## Key workflow nodes for FLUX 2

| Node | Class | Purpose |
|------|-------|---------|
| 93 | `PrimitiveString` | Your text prompt |
| 79 | `EmptyFlux2LatentImage` | Resolution (width/height) |
| 94 | `Flux2Scheduler` | Steps count |
| 73 | `FluxGuidance` | Guidance scale (default: 4) |
| 87 | `RandomNoise` | Seed for reproducibility |
| 89 | `SaveImage` | Output filename prefix |
