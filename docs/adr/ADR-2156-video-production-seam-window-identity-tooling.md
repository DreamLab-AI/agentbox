---
id: ADR-2156
title: Video production gains measured seam, window, stitch, lint and identity tooling, with every borrowed threshold provisional
date: 2026-10-30
decision_status: proposed
implementation_status: partial
activation_status: staged
supersedes: []
superseded_by: []
verified_commit:
verified_paths: []   # arm on acceptance: [skills/video-production/runtime/src/**, comfyui-sidecar/nodes/agentbox_video/**, comfyui-sidecar/Dockerfile, skills/comfyui/scripts/comfy_client.py, skills/comfyui/mcp-server/server.js]
owner: jjohare
review_trigger: first calibration run on estate material; first live H3 or LTX window-relay qualification; any change to a retake-geometry/1, stitch/1, window-plan/1 or seam-qa/1 field; any proposal to import code from H3STUDIOFILM
repo: agentbox
domain: GOVERNANCE-capabilities
---

# ADR-2156 — Video production gains measured seam, window, stitch, lint and identity tooling, with every borrowed threshold provisional

## Context
This amends ADR-2150 (adds tools and gates inside its evidence discipline; its decision stands). ADR-2150's toolkit verified hashes, clocks and receipts but had no measurement at a cut, no plan for windowed long generations, no frame-exact join and no pre-GPU lint. Two third-party ComfyUI film projects were mined on 2026-10-30: H3STUDIOFILM (`h3-relay` and retouch nodes GPL-3.0, no root licence; MiniMax H3 model, which DreamLab is permitted to use and holds) and Kinoloom (MIT; LTX-based). Their failure notes recorded concrete defects this estate would repeat: `xfade` exporting 123 of 124 frames, seconds-to-frames rounding moving retakes by two frames at 24 fps, V3 `COMBO` menus reporting an installed model missing, and a global `interrupt()` on timeout. Their numeric gates were tuned on one author's material and are unvalidated here.

## Decision
1. **Clean-room for H3.** No H3 source is read by an implementer or copied. H3-derived behaviour is re-specified in our words (window grids, seed increment, plan-hash keys, 22/17/5 relay, ≥4-frame rolls, trim-and-blend joins, idle-gated `/free`) and implemented from that spec. Kinoloom code may be adapted with an `Adapted from Kinoloom (MIT)` comment and a NOTICE entry.
2. **New runtime tools** (`skills/video-production/runtime`), all deterministic, all root-relative receipts, built on one decode module (`media.rs`, ffmpeg raw pipes; `-fps_mode passthrough`, since ffmpeg 9 removed `-vsync`):
   - `seam-qa`: per-join look/detail/audio/overlap metrics. A look or pop step fails only above both its absolute gate and `baseline_multiplier` × the local step 12–24 frames away.
   - `stitch`: `assemble` (trim by index plus linear blend `w=(j+1)/(O+1)` in one bt709 encode, no `xfade`), `retake`, `plan-retake`. Output frame count, rate, canvas, colour tags and source audio packet hashes are asserted after the encode, and the output is deleted on mismatch. Generated audio is never used unless named as the approved source.
   - `window-plan`: profile grids (H3 `17n+5` windows with `17k+1` history, LTX `8n+1`, generic). Keys are chained by `plan_hash` and the per-window seed, so rerolling window N invalidates N onward and never earlier windows. `render-cache --allow-from-diff` takes the scope from a `window-diff/1`, refuses a diff planned for a different frame count, and records the diff's hash.
   - `prompt-lint`: reference, start-image, look, emotion-jump, continuity and take-cap rules over film and performance plans, before GPU spend.
3. **ComfyUI client** (`comfy_client.py`, `server.js`, `comfy.rs`):
   - a capability snapshot against a per-workflow manifest, reading both `COMBO` wire forms;
   - a `/system_stats` probe before `/object_info`;
   - `safe_free`, a best-effort idle check before and after `/free` with a settle delay. A job can still arrive between the check and the call; ComfyUI applies free flags between prompts, so this is not destructive. A skipped or raced free returns `success: false` (exit 3).
   - a VRAM headroom record in each submission receipt;
   - an owned-only `cancel`.
4. **Sidecar node pack** `comfyui-sidecar/nodes/agentbox_video`, copied into the image:
   - hash-verified latent and image staging;
   - window relay prep;
   - optical-flow mask tracking that fails closed on area and scale bounds;
   - retake prep;
   - identity scoring and an opening-frame chooser on YuNet (MIT) and SFace (Apache-2.0) from pinned opencv_zoo hashes.

   `opencv-python-headless==5.0.0.93` replaces the GUI wheel, because 4.12 caps numpy below 2.3.
5. **One retake geometry contract.** The node and `stitch plan-retake` both emit `retake-geometry/1`, with rolls ≥ max(4, overlap). Agreement is fixture-pinned, not proven: both suites read `tests/retake_geometry_cases.json`, so drift in either implementation fails a test.
6. **Borrowed thresholds are configuration with provenance.** Seam, identity, lint and unchanged-range PSNR thresholds carry `provenance` and `calibrated: false`. `calibrated: true` is honoured only with a `threshold-calibration/1` record for the same tool and provenance, verified by sha256 under the root (`runtime/src/calibration.rs`, `identity.py`); a bare claim is refused. An uncalibrated PASS is `provisional: true, acceptance_backing: false` (stitch: `PASS_PROVISIONAL`), and so is any lint PASS with skipped rules. Plain `stitch assemble` has no borrowed thresholds (exact frame count, rate, colour and audio-hash gates), so it may back acceptance.

## Consequences
- Seams, joins, windowed reruns and prompt defects become measurable and receipted before and after GPU spend. The known `xfade`, rounding, `COMBO` and global-interrupt defects are covered by tests.
- Changing total frames, max window or history re-renders every window, even where early delivery intervals coincide (`plan_hash` is in every key). This is deliberate conservatism; finer reuse needs its own decision.
- Thresholds stay provisional until a calibration run on estate material produces a hashed `threshold-calibration/1` record. Until then these gates warn and route to review; they do not accept.
- H3 window and relay profiles are unit-tested arithmetic only. H3 qualification is NOT_RUN until a live sidecar with the H3 weights runs a smoke job. The node pack has not run inside a live ComfyUI.
- The image build changes (node pack, OpenCV swap). BFSnodes and scenedetect lose the GUI OpenCV wheel; their import must be confirmed at the first rebuild. The build is started from the host shell, never from inside agentbox.
- Decode is fail-closed on what `media.rs` cannot represent: untagged YUV in `stitch` (unless the segment declares `colour`), HDR transfer, BT.2020 primaries, rotation and non-square SAR are refused. `seam-qa` still decodes untagged sources with the ffmpeg default; a mismatch then lowers overlap PSNR and fails rather than passes.
- `window-plan` hashes model files under `--root`; `--model-hash-unverified PATH=HEX` is the explicit escape for weights not on the box (H3 here) and marks the plan unverified. `render-cache --allow-from-diff` binds to the parent's `plan_hash` and `plan_final_key`.
- Window keys now include each model's `verified` flag, so `window-plan/1` files written before this change fail `verify()`; none exist outside tests.
- Follow-on work: calibration fixtures with real faces and real chains; a live window-relay qualification; and an inline review of the 22/17/5 relay against the chosen model's latent stride.

## Verification
On branch `media/vp-sprint-integration`, merged from seven worker branches on a shared base (`7e2fb8939`):
- `cargo test --offline` in `skills/video-production/runtime`: 143 passed, 0 failed. `cargo clippy --all-targets -D warnings` and `cargo fmt --check` are clean.
- Node pack `python -I -m unittest discover`: 55 OK. ComfyUI client: 26 OK. `node --test server.test.js`: 9/9.
- No H3 identifiers (`h3_relay`, `removal_cache`, `retouches_*`, `_safe_comfy_free` and others) appear in the changed files.
- Image build, live sidecar, H3 weights and calibration: NOT_RUN. `verified_commit` stays blank until acceptance.
