---
id: ADR-2175
title: Image-to-splat is a pinned SplatKit dataset stage in the ComfyUI sidecar, driven by API, trained outside it
date: 2026-11-04
decision_status: accepted
implementation_status: partial
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 65778e973db5587ec1c9bfe13ad3b46f44a523d7
verified_paths: [comfyui-sidecar/Dockerfile, comfyui-sidecar/nodes/agentbox_video/splat_export.py, skills/comfyui/scripts/splat_pipeline.py, skills/comfyui/scripts/ui_to_api.py, skills/comfyui/scripts/download_video_models.py, skills/comfyui/manifests/splatkit.json]
owner: jjohare
review_trigger: SplatKit or Mickmumpitz-Nodes pin bump; Krea 2 Community Licence change; Matrix-3D gate or file change; any proposal to install SplatKit's managed training venv, 4DAnyone, ultralytics or an attention patch in the sidecar; LichtFeld gate change; ADR-2148 control-plane change
repo: agentbox
domain: BASELINE-container
relates: [ADR-2148, ADR-2150]
evidence_class:
acceptance_boundary: image rebuilt from the host with SPLATKIT=1, verify-splatkit.sh and verify-spede.sh PASS, splat-pano and splat-dataset provisioned, probe --manifest splatkit.json PASS, and one CC0 pano and one perspective photo carried to a fetched dataset that LichtFeld trains
---

# ADR-2175 — Image-to-splat is a pinned SplatKit dataset stage in the ComfyUI sidecar, driven by API, trained outside it

## Context
- Agents should turn one image into a 3D Gaussian splat through the ComfyUI sidecar's API (ADR-2148). The sidecar already edits splats (SpEdE, gsplat 1.5.3) and LichtFeld trains them; nothing produced the training dataset.
- `mickmumpitz/ComfyUI-SplatKit` (MIT, `47c93ee9`) does: pano → MoGe depth mesh → camera fly-through → Wan 2.1 I2V with the Matrix-3D pano LoRA filling disocclusions → HiRes Composite (reprojects the 8K pano along the rail) → SphereSfM → COLMAP `images/` + `sparse/0`.
- The operator's panorama front end is Krea 2 Turbo + Ostris Edit + `mickmumpitz/Krea2-360-ERP-LoRAs`. Its pano nodes exist only from Mickmumpitz-Nodes `270afbd` (the workflow's `e3df7e11` stamp predates them). A real 360° photo needs no front end.
- Headless control works at these pins: anchors are a text widget, "compute geometry" is an ordinary queued node plus `GET /splatkit/suggest_paths`, and Plot Camera returns a `camera_preview` image. `Bundle`/`UnbundleByName` store their meta widgets in a frontend order that differs from the schema.

## Decision
1. **Stages.** Four ComfyUI jobs, each with a durable receipt, driven by `skills/comfyui/scripts/splat_pipeline.py`: **pano** (image or text → 2K pano, seam fix, tiled 8K refine, then the wrap seam re-blended from the 2K pano rolled 50%, because the tiled refine re-details the two edge tiles independently), **geometry** (MoGe scene reference + suggested paths), **preview** (per path a path plot and three depth-mesh views, judged before any Wan run), **dataset** (1–4 paths → Wan fill → HiRes Composite → dual-res SphereSfM → export). Rerunning a stage resumes its receipt and never resubmits; a receipt for a different graph is refused. `safe_free` precedes the Krea and Wan stages. Training stays outside ComfyUI.
2. **Image build.** `--build-arg SPLATKIT=1` (default) bakes SplatKit, Mickmumpitz-Nodes `270afbd`, Krea2-Ostris-Edit and UltimateSDUpscale (with its submodule) unmodified. `opencv-python` and `ultralytics` (AGPL, imported lazily by an unused face node) are filtered from requirements with asserted filters; numpy and torch are held by constraint. The SphereSfM Linux bundle installs from a sha256-pinned archive, so its first-use download never runs. `TORCH_HOME` points at the models volume for torchvision's RAFT weights. Not installed: SplatKit's managed training venv, 4DAnyone, ComfyUI_essentials (core `ImageSharpen` replaces its CAS), LatLong preview, Sage Attention.
3. **Weights.** Pinned, sha256-verified profiles: `splat-pano` (Krea 2 Turbo fp8, Qwen3-VL 4B, two ERP LoRAs, Wan VAE, RealESRGAN x2) and `splat-dataset` (Wan 2.1 I2V 720P fp8, umt5-xxl, clip_vision_h, LightX2V, RealESRGAN x4 in place of CC BY-NC-SA 4x-UltraSharp, MoGe ViT-L at `models/MoGe/model.pt`, RAFT). Graphs name `model.pt` so SplatKit's auto-download is never reached. The downloader gains `derive` entries (pinned source → converter baked in the image → safetensors header canonicalised → pinned output hash); `splat-matrix3d` (also inside `splat-dataset`) derives the Matrix-3D LoRA with SplatKit's `convert_pano_lora.py`. Two conversions differed only in safetensors metadata key order, so the hash is taken after canonicalisation.
4. **Agent contract.** API graphs `skills/comfyui/workflows/splat-{pano-image,pano-text,geometry,path-preview,dataset}.api.json` use semantic node ids. Pano graphs transcribe the operator workflow; the dataset graph is SplatKit's workflow 1 converted by the new `ui_to_api.py` (schema-driven, flattens bundles, handles v3 dynamic combos and upload widgets, fails loudly). The agent supplies an image (FOV from EXIF 35 mm focal length or `--h-fov`; the deprecated estimator is not used), one scene sentence, 1–4 paths and a name; it does not change frame length, curves, samplers or seeds. `manifests/splatkit.json` is generated from the graphs.
5. **Export.** `agentbox_video` gains `AgentboxSplatDatasetExport`: it lists `images/` and `sparse/` under the dataset as `ui.files` entries with sha256, refusing paths or symlinks outside `output/`. `comfy_client` downloads `files` entries and enforces the hash; `splat_pipeline` rebuilds the tree under `$WORKSPACE/splats/<name>/dataset`. No volume is shared, so a remote ComfyUI works.
6. **Training.** LichtFeld trains the fetched dataset (gate unchanged, operator step); spark-scene views, SpEdE edits.
7. **Licences.** Krea 2 Community License v1 (read 2026-11-04): commercial use only below USD 1M trailing annual company revenue, content-filter duty §4.2 (operator review of outputs before publication), AI disclosure §4.3, notice text in `NOTICE`. Wan, LightX2V Apache-2.0; Matrix-3D, MoGe, packs MIT; UltimateSDUpscale GPL-3.0; SphereSfM BSD-3 with bundled LGPL/GPL libraries as a separate executable.

## Consequences
- An agent can take a photo, prompt or 360° image to a hash-checked COLMAP dataset with no browser, and catches wall-crossing paths in a cheap preview job.
- The image gains four packs and a 53 MB SfM bundle; the models volume gains about 46.4 GB plus the 614 MB Matrix-3D source. A four-path dataset job is tens of minutes on one GPU and shares the queue with video and SpEdE work.
- `ui_to_api.py` is reusable for any further operator workflow handed to agents.
- Not adopted: Apple SHARP (licence; detail fails under motion), HunyuanWorld 2 (four-GPU design), Lyra (91 GB), Marble (closed), SplatKit's in-pack trainer.

## Verification
Partial, staged. Established in this change:
- Rebuilt `agentbox-comfyui:local` from the implementation commit: in-build SplatKit assertions passed (COLMAP 3.8 runs, filtered requirements absent, torch unchanged); `verify-splatkit.sh` and `verify-spede.sh` ALL PASS on the recreated sidecar; live `geometry` on the production `:8188` returned four suggested paths.
- `agentbox_video` suite in the sidecar: 98 tests OK (5 new export tests). Script suites: `test_comfy_client.py` 33, `test_download_video_models.py` 13, `test_splat_pipeline.py` 18, `test_ui_to_api.py` 5, all OK. `skills/lint-skills.sh` clean.
- A throwaway ComfyUI on :8189 inside the running sidecar (the four packs at these pins under `/tmp`, removed afterwards) registered every graph node, and all five graphs validated against its `/object_info` apart from files still provisioning. The SphereSfM bundle's sha256 matched and `colmap_sphere help` ran.
- Live on that server with the CC0 Poly Haven `aerodynamics_workshop` 8K pano and verified MoGe/RAFT weights: `geometry` completed in 56 s and `suggest_paths` returned four paths (push-in, arc sweep, crane rise, pull-back); `preview` completed in 81 s with path plots and start/middle/end depth-mesh views for every path; rerunning `preview` after a graph change was refused by the receipt guard. The `pano` and `dataset` graphs have not run yet (Krea and Wan weights were still downloading; Matrix-3D gated).

Matrix-3D: access accepted 2026-11-04; source `a511537e…` verified, two conversions byte-identical after canonicalisation (`e50beda5…`, 306,809,616 bytes), and `derive()` published it in the sidecar.

End-to-end run, 2026-11-05, production `:8188` after `splatkit.json` probe PASS (59/59): input a 1600×1200 view rendered at a known 75° h_fov from the CC0 `aerodynamics_workshop` pano (`--h-fov 75`).
- `pano` (image mode) 4 m 14 s → 8192×4096 pano, coherent around the full sphere. The first run exposed a hard wrap seam at 8K (mean |Δ| across the wrap 14.07 against an interior-column p90 of 3.75; 6.36 at 2K, so the tiled refine introduced it). Both pano graphs now re-blend the wrap from the 2K pano rolled 50% (512 px strip, 192 px ramps); the rerun measured 2.27 with interior statistics unchanged. Cost: a slightly softer 512 px band at the wrap.
- `geometry` 58 s (four paths); `preview` 86 s (16 images); push-in end frame judged inside the room.
- `dataset`, push-in only, 18 m 51 s: 249 files (923 MB) exported, identical to the container's `images/` + `sparse/0/`. COLMAP: one 2048² SIMPLE_PINHOLE (f 1024), 246/246 images registered (41 frames × 6 cube faces sharing one centre each), 4,659 points, median track 6; reprojection errors are COLMAP's `-1` (known-pose triangulation, no bundle adjustment). Reconstructed path curvature (length/displacement 1.07) matches the planned anchors (1.066); scale is arbitrary.
- Quality: horizon faces coherent and sharp, with visible patch edges where the 8K reprojection meets the Wan fill; the end-frame face looking back at the large disocclusion is filled with dark, ambiguous geometry (34% near-black), which would train as floaters. Mitigation is path choice (shorter push-ins, extra paths covering disocclusions), not a pipeline fault.
- The client's dataset summary overwrote the file list with its count and crashed after the export; fixed (`summarise_dataset`, tested), and the rerun resumed the receipt in 4 s without resubmitting.

Open until the acceptance boundary: a multi-path dataset and LichtFeld training.
