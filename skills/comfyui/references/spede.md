# ComfyUI-SpEdE (Gaussian-splat remove, extract, replace)

`Burgstall-labs/ComfyUI-SpEdE` (AGPL-3.0-or-later) is baked into the ComfyUI sidecar at
commit `78b2a011ae8c47e702b25759c95d140784da97ce`, unmodified, with gsplat 1.5.3 compiled
ahead of time for sm_86 and sm_89 (RTX A6000, RTX 6000 Ada). Attribution is in `NOTICE`.

## What it does

It edits a 3D Gaussian-splat scene (a 3DGS PLY plus a camera pack) from ComfyUI graphs:
select an object with SAM 3.1, then **extract** it, **remove** it (Qwen-Image 2.1 repair, MoGe-3
depth, depth-driven Gaussian births), or **replace** it (TripoSplat object registered into the
scene). Results are judged by gates: G1, G2, G3 (geometry and render checks on the edit), H1
(held-out cameras outside the mask) and K1. The all-around fill has an independent and a
progressive method. The experimental orbit (MiniMax H3 ref2va) is not provisioned here.

## Build and gate

`comfyui-sidecar/Dockerfile` base is CUDA 13.0.3 devel (nvcc must match torch's cu130 major).
`--build-arg SPEDE=0` skips gsplat and SpEdE. Only SpEdE's `requirements.txt` is installed, with the
gsplat line filtered; `studio/requirements.txt` (upstream UI: fastapi, comfy-sdk) is not,
because the node pack imports none of it. After a host build run
`docker exec -i comfyui bash -s < comfyui-sidecar/verify-spede.sh`.

## Weights

```bash
docker exec comfyui python /opt/agentbox-media/scripts/download_video_models.py --profile spede --plan
docker exec comfyui python /opt/agentbox-media/scripts/download_video_models.py --profile spede-replace
```

| Profile | Contents | Licence |
|---|---|---|
| `spede` | SAM 3.1 multiplex fp16; Qwen-Image 2.1 and turbo int8 convrot; Qwen3-VL 8B int8 convrot; Qwen-Image 2.1 VAE; MoGe-3 ViT-L fp16 (`geometry_estimation/`) | SAM License; **Qwen-Image 2.1 Research (non-commercial)**; MIT |
| `spede-replace` | `spede` plus TripoSplat fp16, TripoSplat VAE decoder, DINOv3 ViT-H (`clip_vision/`), FLUX.2 VAE | adds MIT; DINOv3 License (restricted); Apache-2.0 |

Revisions, sizes and sha256 come from the Hugging Face API. About 27 GB for `spede`, 3.3 GB more for Replace.

## Probe

`python3 skills/comfyui/scripts/comfy_client.py probe --manifest skills/comfyui/manifests/spede.json`
checks the SpEdE and core node classes and each loader's file choices. **BLOCKED is the correct
result until the pack is installed and the profiles are provisioned.**

## Not verified

- ComfyUI is pinned at 0.42.0; upstream tested 0.41.0. The progressive node calls V3 internals
  (`TextEncodeQwenImage21.execute`, `ManualSigmas`, `CFGGuider`, `SamplerCustomAdvanced`). All of these
  classes exist at the pinned revision, but behaviour is unproven.
- Upstream tested 32 GB VRAM only (RTX 5090); the RTX A6000 is 48 GB and the 6000 Ada 48 GB, but nothing has run.
- gsplat 1.5.3 on torch 2.14 + CUDA 13.0 has not been compiled; `SPEDE=0` is the fallback.
- No SpEdE graph has run in this image.
