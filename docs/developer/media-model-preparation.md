# Prepare remote media services and model profiles

Run builds from the **host's Agentbox checkout**, where Docker build paths
resolve to the edited sources. Do not launch these builds from the Agentbox
container. Model provisioning is separate from image builds.

## Rebuild order

Prepare Agentbox without replacing the current session:

```bash
./agentbox.sh prepare
```

Build the two changed sidecar images, retaining their existing volumes:

```bash
docker compose --project-name agentbox -f docker-compose.gui-tools.yml build
docker compose --project-name agentbox -f docker-compose.comfyui.yml build
```

When preparation succeeds and the current GPU queue is idle (or the operator
has deliberately deferred its jobs), recreate only these services and activate
the prepared Agentbox image:

```bash
docker compose --project-name agentbox -f docker-compose.gui-tools.yml up -d --no-deps gui-tools-service
docker compose --project-name agentbox -f docker-compose.comfyui.yml up -d --no-deps comfyui
./agentbox.sh activate
```

There is no need to rebuild the browser sidecar for this change. None of these
commands removes model, input, output, user or GUI exchange volumes. The
existing `agentbox-media-provision-core` download worker is independent of the
GPU sidecars and can continue during their rebuild. Inspect it before starting
another provisioning worker.

## Runtime credentials

`HF_TOKEN` belongs in the gitignored host `.env`. Compose passes it to runtime
provisioning, never to a Docker build argument. Agentbox already loads that
file through its existing override. Model access is a separate account grant:
a valid token alone does not unlock a gated repository. The initial operator
account has now granted LTX-2.5, Layout-to-Render and Ingredients access.

## Model plan and downloads

The baked manifest is
`/opt/agentbox-media/models/stopmotion-candidates.json`; its source is
`skills/comfyui/models/stopmotion-candidates.json`. Every file has a publisher
revision, byte count, SHA-256 and model-directory destination. The downloader
retains partial transfers, locks writers, verifies and atomically publishes.

Inspect the existing worker:

```bash
docker inspect agentbox-media-provision-core --format '{{.State.Status}}'
docker logs --tail 20 agentbox-media-provision-core
```

After the ComfyUI image rebuild, inspect the actual model volume and available
nodes without loading a model or submitting a prompt:

```bash
docker exec comfyui python /opt/agentbox-media/scripts/download_video_models.py --campaign core --plan --url http://127.0.0.1:8188
```

A matching size remains unverified. Verify hashes after downloads finish:

```bash
docker exec comfyui python /opt/agentbox-media/scripts/download_video_models.py --campaign core --verify-only
```

If no provisioning worker is already active, the repeatable one-shot Compose
worker resumes the same pinned core profiles without allocating a GPU:

```bash
docker compose --project-name agentbox -f docker-compose.comfyui.yml --profile provision up -d model-provision
docker logs -f agentbox-media-provision
```

Choose specific comparisons using repeated `--profile` arguments to the
baked downloader, first with `--plan`. Core fits the current volume with the
20 GiB reserve; the full comparison union requires more storage or phased
provisioning. Unloading a model releases VRAM, not its disk files.

## Before overnight inference

Use `skills/comfyui/scripts/comfy_client.py` from Agentbox to inspect health,
validate the exact API graph and submit with a new durable receipt. Resume the
same receipt after observation timeouts. Do not infer completion from a quiet
WebSocket, an output filename or a submission ID. Retain input hashes, graph,
models, seed, native frame timing and the approved voice stem.

Blender's raw/MCP socket is at localhost:9876 through the existing proxy;
DCC-MCP's typed gateway is at `http://gui-tools-service:9881/mcp`. Start with
live discovery rather than hard-coded instance IDs. Long renders use the
existing background-job tool and exchange volume. The sidecar also bakes
Rhubarb 1.14 with its CPU speech resources.

The two completed H3 endpoint clips prove the short Blender-to-ComfyUI path.
They do not establish production-resolution cadence, complete speech timing
or any newly downloaded model's quality. Further generation is deferred until
model preparation and the selected graph preflight are complete.

## Optional LTX 2.5 regional prompting

The ComfyUI image pins `yuvraj108c/ComfyUI-LTX-BBox-Animator` at
`c4b0a9db7b523abcdb2245c648992415e1f9dd7a`. It supplies animated boxes and
per-region text/mask conditioning. Its dependencies are already supplied by
ComfyUI; no extra pip installation is needed. The `ltx25-bbox-adapter` profile
adds only the 327,287,352-byte LoRA to the persistent models volume, reusing the
existing LTX 2.5 base model, encoder and VAEs:

```bash
docker exec comfyui python /opt/agentbox-media/scripts/download_video_models.py --profile ltx25-bbox-adapter --plan
docker exec comfyui python /opt/agentbox-media/scripts/download_video_models.py --profile ltx25-bbox-adapter
docker exec comfyui python /opt/agentbox-media/scripts/download_video_models.py --profile ltx25-bbox-adapter --verify-only
```

This is an explicit optional profile, excluded from the default campaign. Rebuild
the ComfyUI sidecar from the host to bake the nodes; rebuilding agentbox alone
does not replace that image. Retain all media volumes. After recreation, check
`LTXRegionalBBoxAnimator`, `LTXApplyRegionalConditioning`, `LTXRegionalPrompt`
and `LTXRegionalPromptFromImage` in `/object_info`, and check the LoRA loader.
Import success and a verified model file do not prove generation quality or
compatibility with other attention patches. Evaluate the supplied standalone
workflow before combining it with Layout-to-Render. Both upstream package and
model card declare GPL-3.0; retain their licence material.

## Optional ComfyUI-SpEdE (Gaussian-splat remove, extract, replace)

The ComfyUI image bakes `Burgstall-labs/ComfyUI-SpEdE` (AGPL-3.0-or-later) at
`78b2a011ae8c47e702b25759c95d140784da97ce`, unmodified, on a CUDA 13.0.3 devel base with
gsplat 1.5.3 built ahead of time (`--build-arg SPEDE=0` skips both). The `spede` and
`spede-replace` profiles add the SAM 3.1, Qwen-Image 2.1 (non-commercial), MoGe-3 and TripoSplat
weights to the models volume. Run `docker exec -i comfyui bash -s < comfyui-sidecar/verify-spede.sh`
after the host rebuild. Details, the probe manifest and the untested points are in
`skills/comfyui/references/spede.md`.
