# Agentbox local video sidecar

Run from the agentbox repository on a Docker host with an NVIDIA runtime:

```bash
docker compose -f docker-compose.comfyui.yml build
docker compose -f docker-compose.comfyui.yml up -d
curl --fail http://localhost:8188/system_stats
```

From the agentbox container use `http://comfyui:8188`. The Compose overlay joins
the existing `agentbox_default` network, configurable with `COMFYUI_NETWORK`.
`COMFYUI_GPU_DEVICE` selects one device ID or GPU UUID, default `0`. Inspect free
VRAM before choosing a card; other sidecars may already use it. Models, input,
output and saved user workflows persist in separate named volumes.

If the agentbox image has a read-only Docker configuration directory, point
`DOCKER_CONFIG` at a writable task directory when building. The mounted Docker
socket still targets the host daemon. Do not start a competing build in another
terminal when the original build process is live.

The Dockerfile pins ComfyUI and the PyTorch/CUDA wheel family. BuildKit caches
Python downloads and pip resumes interrupted transfers. The host driver must
support the wheels' CUDA runtime. The base image's toolkit version alone does
not identify the runtime used by PyTorch: verify `torch.version.cuda` in the
running service and inspect `/system_stats`. See
[H3 compatibility](h3-compatibility.md) before changing quantisation profiles.

Provision the pinned model profile inside the service's model volume:

```bash
docker cp skills/comfyui/scripts/download_video_models.py comfyui:/tmp/download_video_models.py
docker exec comfyui python /tmp/download_video_models.py --profile h3 --models-dir /opt/ComfyUI/models
docker exec comfyui python /tmp/download_video_models.py --profile h3 --models-dir /opt/ComfyUI/models --verify-only
python3 skills/comfyui/scripts/comfy_client.py --url http://comfyui:8188 health
```

The downloader retains `.part` files on interruption and publishes only verified
weights. Re-run a terminally failed download to resume it; observe the existing
process while it remains live. A valid model inventory is followed by graph
validation, a short execution smoke test and a production-length quality test.
Use the [model workflow reference](video-models.md) and
[durable job harness](agent-kit.md) for those steps.

Do not run a host-path installer against `/opt/ComfyUI` in the agentbox container:
that directory belongs to the sidecar. Submit graphs and retrieve media through
HTTP. Diagnose startup with `docker logs comfyui --tail 100`; retain model
volumes during service rebuilds.

For memory pressure, inspect the running version's `main.py --help` before
adding flags. At the pinned revision, asynchronous offloading is enabled by
default on NVIDIA; `--disable-smart-memory` requests more aggressive offloading
to host RAM. `--lowvram` has no effect while dynamic VRAM is enabled. Preserve
the active prompt receipt and wait for a terminal state before restarting a
service to change these settings.

The native `SelectModelDevice`, `SelectCLIPDevice` and `SelectVAEDevice` nodes
support assigning stages to available devices. For two-GPU execution, expose
exactly the intended GPUs in Docker's device reservation, then inspect the
refreshed `/object_info` choices before editing the graph. A single exposed GPU
does not provide a second CUDA target. `--cuda-device` accepts a device list;
`--default-device` changes the default while keeping other visible devices
available. Check live free VRAM and map container device IDs to GPU UUIDs.
Multi-GPU placement must be proven with a live render; exposing two cards alone
does not establish that a model is distributed between them.
