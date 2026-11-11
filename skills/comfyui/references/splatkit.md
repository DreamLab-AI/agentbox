# Image to Gaussian splat (SplatKit dataset stage, ADR-2175)

One photo, a text prompt or a real 360° image becomes a COLMAP dataset (`images/` +
`sparse/0/`) that LichtFeld Studio trains into a splat. ComfyUI produces the dataset;
it does not train. Everything runs through the sidecar's HTTP API with no browser.

## Pipeline

| Stage | Command | GPU work | Output |
|---|---|---|---|
| pano | `splat_pipeline.py pano` | Krea 2 Turbo (2K pano, seam fix) + tiled 8K refine + 8K wrap-seam blend | `pano/…pano_8k_*.png` |
| geometry | `splat_pipeline.py geometry` | MoGe depth on the pano | `paths.json` (suggested camera paths) |
| preview | `splat_pipeline.py preview` | depth-mesh fly-through per path | `preview/…preview_pN_*.png` |
| dataset | `splat_pipeline.py dataset` | Wan 2.1 I2V 14B + Matrix-3D LoRA fill, HiRes Composite, SphereSfM | `dataset/images`, `dataset/sparse/0`, `dataset.json` |

Skip `pano` for a real 2:1 equirectangular image: pass `--pano image.png` to the later
stages. All files land in `$WORKSPACE/splats/<name>/` (override with `--workdir-root` or
`$SPLAT_WORKDIR`). The graphs are `skills/comfyui/workflows/splat-*.api.json`.

```bash
S=skills/comfyui/scripts/splat_pipeline.py
python3 $S pano --name village --image photo.jpg --scene "A sunlit alpine village square with a pond."
python3 $S geometry --name village            # writes paths.json from /splatkit/suggest_paths
python3 $S preview --name village             # look at every preview before the next step
python3 $S dataset --name village             # 81 frames per path; tens of minutes per path
```

Each stage writes `receipts/<stage>.json` before submitting. Rerunning a stage whose
receipt exists **resumes that job and never resubmits**; exit code 2 means only the
observation timed out. To redo a stage on purpose, read its receipt, then delete it. The
client calls `safe_free` before the Krea and Wan stages, so one 48 GB card holds one model
family at a time.

## What the agent supplies

- **Input image** (image→pano): uploaded to `input/` as `<name>_input.<ext>`. The photo stays in the
  panorama untouched; Krea 2 + Ostris Edit + the ERP outpaint LoRA paint the rest.
- **Horizontal FOV**: read from EXIF `FocalLengthIn35mmFilm`, otherwise `--h-fov`
  (phone main camera ≈ 70, wide ≈ 90). The client refuses to guess, because the
  upstream FOV estimator is deprecated with roughly 18° mean error.
- **Scene sentence**: one sentence about the surroundings. Text→pano takes `--text`
  instead; the LoRA trigger prefix is added for you.
- **1–4 camera paths** in `paths.json`. Each path is `{label, orientation, anchors,
  look_at_target}`, with anchors as `x, y, z` lines (or `x, y, z, tx, ty, tz` for
  `per_point_look`). The frame is the pano camera: +Z forward, +X right, +Y up, start at
  the origin, units of the MoGe scene.
- **Name**: `[A-Za-z0-9_-]`, used for the work folder, dataset folder and scene reference.

Do not change frame length (81, tied to Wan), the timestep curve, the samplers or the seeds
inside the graphs. Those are the operator workflow's tuned values.

## Judging camera paths

The suggested paths are archetypes (push-in, arc sweep, crane rise, pull-back) fitted to
the free space in the MoGe cloud and relaxed away from it. `preview` writes two kinds of
image per path:

- `preview_pN`: top-down and side plots of the path alone, with no scene. Use it for shape
  and height, not for collisions.
- `view_pN_f00`, `f40`, `f80`: what the camera sees at the start, middle and end. This is
  the depth-mesh render Wan receives. **Black regions are expected**: they are the
  disocclusions Wan and the Matrix-3D LoRA paint in, and a raised or sideways camera shows
  more of them.

Reject or shorten a path when a view frame is:

- **mostly black**, so the camera has left the reconstructed space and Wan would invent
  most of the frame;
- **filled by one close surface**, so the camera is inside or against a wall or object;
- **nearly identical at f00 and f80**, so the path barely moves and adds little coverage.

Areas no path looks at stay soft in the splat, so cover what matters to the shot. Edit
`paths.json` and rerun `preview`. The stage refuses its old receipt because the graph
changed; delete `receipts/preview.json` once you have read it. Only then run `dataset`.

## Provisioning

Two pinned profiles in `download_video_models.py` (revision, size and sha256 from the
Hugging Face API; nothing downloads at node run time):

```bash
docker exec comfyui python /opt/agentbox-media/scripts/download_video_models.py --profile splat-pano --profile splat-dataset --plan
docker exec comfyui python /opt/agentbox-media/scripts/download_video_models.py --profile splat-pano --profile splat-dataset
python3 skills/comfyui/scripts/comfy_client.py probe --manifest skills/comfyui/manifests/splatkit.json
```

`splat-pano` is about 19 GB (Krea 2 Turbo fp8, Qwen3-VL 4B, the two ERP LoRAs, the Wan VAE,
RealESRGAN x2). `splat-dataset` is about 28 GB (Wan 2.1 I2V 720P fp8, umt5-xxl, clip_vision_h,
the LightX2V LoRA, RealESRGAN x4, MoGe ViT-L, torchvision RAFT under `TORCH_HOME`).

`splat-dataset` also includes the Matrix-3D pano LoRA (`pano_video_gen_720p_comfy.safetensors`,
also provisionable alone as `splat-matrix3d`). It is a derived file: the downloader fetches the
gated `Skywork/Matrix-3D` source `.bin` (revision `9f23eda5`; the account behind `HF_TOKEN`
must have accepted the repository terms) into `models/.sources/`, runs SplatKit's
`tools/convert_pano_lora.py` (baked in the image), canonicalises the safetensors header
(safetensors writes metadata keys in hash-map order) and publishes only an output matching
the pinned sha256.

## Training and viewing

No splat trainer is baked into agentbox: train `dataset/` with a COLMAP-reading trainer on a
GPU machine (raise the Gaussian cap to about 3M for HiRes Composite datasets), view with
**spark-scene**, and edit objects with SpEdE
(`references/spede.md`). Any COLMAP-reading trainer works (Brush, gsplat, Postshot).

## Licences

| Component | Licence | Note |
|---|---|---|
| Krea 2 Turbo, ERP LoRAs | Krea 2 Community License v1 | Commercial use only below USD 1M trailing annual company revenue; content-filter duty (§4.2), AI disclosure where required (§4.3) |
| Wan 2.1, umt5, clip_vision_h, LightX2V | Apache-2.0 | |
| Matrix-3D LoRA | MIT (gated download) | |
| MoGe, SplatKit, Mickmumpitz-Nodes, Krea2-Ostris-Edit | MIT | |
| UltimateSDUpscale | GPL-3.0 | Sidecar runtime only |
| SphereSfM bundle | BSD-3-Clause (COLMAP 3.8) | Bundled `lib/` includes LGPL/GPL SuiteSparse and FreeImage modules; separate executable |
| RealESRGAN, RAFT | BSD-3-Clause | Replaces SplatKit's default 4x-UltraSharp (CC BY-NC-SA 4.0) |

A real 360° photo skips Krea entirely. Review the outputs before you publish anything made
with the Krea front end; that review is the human-review content filter §4.2 accepts.

## Failure guide

| Symptom | Cause | Action |
|---|---|---|
| `probe` BLOCKED on files | profiles not provisioned | run the downloads above; `--verify-only` checks hashes |
| `pano_video_gen_720p_comfy.safetensors` missing | Matrix-3D gate not accepted on the token's account | accept at huggingface.co/Skywork/Matrix-3D, then provision `splat-dataset` again |
| `suggest_paths: no scene reference cloud` | geometry job did not finish | inspect `receipts/geometry.json` |
| Black Wan frames | an attention patch such as SageAttention | the sidecar ships none; do not add one |
| SfM `on_split: stop` failure | paths do not overlap | add a path that crosses the others near the origin |
| Soft areas in the trained splat | the paths never looked there | add or extend a path, rerun `dataset` under a new name |
