---
name: comfyui
description: "Generate AI images and video with ComfyUI's node-based workflows (FLUX, Stable Diffusion, video models) on a local GPU or distributed Salad Cloud compute. Use when a task needs text-to-image, image-to-image, or text/image-to-video generation, ComfyUI workflow authoring, or scaling generation across GPUs."
---

# ComfyUI Skill

Drive ComfyUI for AI image/video generation, node-based workflow authoring, and
distributed GPU compute via the Salad Cloud API. ComfyUI runs in an **external
Docker container** reached over the Docker network — you talk to it through its
HTTP API, never the local filesystem.

## Container architecture (read first)

ComfyUI runs in an EXTERNAL Docker container, not locally. When calling from Claude
Code (its own container), pick the endpoint that matches where you are:

| Scenario | Endpoint | Notes |
|----------|----------|-------|
| From Claude Code container | `http://comfyui:8188` | Docker network hostname |
| From host machine | `http://localhost:8188` | Port exposed to host |
| Container IP (fallback) | `http://172.18.0.X:8188` | Check with `ping comfyui` |

Networking rules that actually bite:
1. From inside the Claude Code container, `localhost:8188` will not reach ComfyUI —
   use the `comfyui` Docker hostname.
2. You cannot read the container filesystem; retrieve outputs via
   `/view?filename=...&type=output`, not filesystem paths.
3. The comfyui container's volume mounts (output/input/models under
   `/mnt/mldata/.../comfyui/...`) are host-accessible only, not from here.

### Check container status
```bash
# From Claude Code container
ping -c1 comfyui  # Should show IP like 172.18.0.X
curl -s http://comfyui:8188/system_stats | jq '.devices[0].name'

# From host
sudo docker ps --filter "name=comfyui"
sudo docker logs comfyui --tail 20
```

## Quick path

Generate a FLUX 2 image end-to-end with the bundled runnable script:

```bash
python /home/devuser/workspace/project/agentbox/skills/comfyui/generate.py \
  "A stunning landscape at golden hour, cinematic lighting" output.png
```

It submits the current FLUX 2 workflow to `http://comfyui:8188`, polls to
completion, and downloads the PNG. For the manual step-by-step (health check →
submit → poll → download), the one-liner variant, VRAM freeing, and the live
model/node tables, see [`references/flux2-quickstart.md`](references/flux2-quickstart.md).

## Capabilities

- Text-to-image (text2img) and image-to-image (img2img) generation
- Author and execute node-based workflows programmatically
- Video generation (AnimateDiff, CogVideoX, HunyuanVideo, LTX, Mochi, WAN, Cosmos)
- Manage models, LoRAs, checkpoints, VAEs
- Upscaling and post-processing
- Deploy to Salad Cloud for distributed GPU compute at scale

## When to use this skill

- Generate AI images from text descriptions or transform image-to-image
- Design ComfyUI workflows programmatically
- Batch-process generation tasks
- Use or fine-tune LoRA models with FLUX/SD
- Generate AI video from text or images
- Deploy image generation at scale across distributed GPUs

## When not to use

- 2D image manipulation (resize, crop, format convert) — use the **imagemagick** skill
- 3D modelling and scene creation — use the **blender** skill
- Video transcoding, editing, or audio extraction — use the **ffmpeg-processing** skill
- Diagrams, flowcharts, architecture visuals — use the **mermaid-diagrams** skill
- ML model training (classification, NLP, time series) — use **pytorch-ml** or **flow-nexus-neural**

## References

Detail lives in `references/` — pull the file that matches the task:

- [`references/flux2-quickstart.md`](references/flux2-quickstart.md) — full FLUX 2
  generate/monitor/download flow, one-liner, VRAM management, current model + node tables.
- [`references/api-and-parameters.md`](references/api-and-parameters.md) — local server
  operations, API endpoints, text2img parameter table, sampler/scheduler lists, output
  conversion, webhooks, error handling, directory layout.
- [`references/workflows.md`](references/workflows.md) — FLUX 2 and legacy FLUX 1 workflow
  JSON structures, supported image/video models, batch-generation Python.
- [`references/salad-cloud.md`](references/salad-cloud.md) — Salad SDK deployment, the full
  recipe catalog (image/video/LLM), hardware recommendations, benchmarks, performance notes.

Bundled runnable assets in this directory:
- `generate.py` — FLUX 2 one-shot generator (quick path above).
- `generate_anima.py` + `anima_workflow.json` / `anima_import_workflow.json` — working
  sample animation workflow and driver.
- `mcp-server/` — ComfyUI MCP server surface.

## Integration with other skills

- **imagemagick** — post-process generated images
- **ffmpeg-processing** — assemble/transcode generated video
- **blender** — 3D-to-2D workflows
- **pytorch-ml** — custom model training
