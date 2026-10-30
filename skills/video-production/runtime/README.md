# video-production-runtime

Verification-first command-line tools for the `video-production` skill. Each
tool refuses to proceed on a stale hash, a wrong clock or an unbacked claim, and
writes receipts that record **root-relative paths only**. Not published to
crates.io (`publish = false`); `src/clock.rs` is written to be lifted out later.

External programs: `ffmpeg`/`ffprobe` (all media tools) and `curl` (ComfyUI
upload; the multipart body is built in Rust and piped in, so filenames never
pass through curl's `--form` syntax). Hashing is `sha2`; there is no other
cryptography.

## Production root

Every tool resolves one root: `--root DIR`, else `$BLENDER_SHARE` (the Blender
skill's exchange directory), else the current directory. All other paths are
relative to it. Paths outside it are rejected.

## Binaries

| Binary | One line |
|---|---|
| `film-bake` | Prepare guides and anchor/video ComfyUI graphs for a whole film, then assemble hash-verified outputs (`prepare`, `videos`, `assemble`). |
| `contract-check` | Check a gate ledger: traceability, safe package paths, hash-backed `PASS` evidence, honest verdicts. |
| `render-cache` | Assemble a complete render cache after a scoped scene edit, within an explicit allowed frame scope (`--allow`, or `--allow-from-diff` with a `window-diff/1` planned for the same frame count). |
| `review-cut` | Assemble a fixed-clock diagnostic edit from hashed media and producer receipts. |
| `dialogue-bake` | Import recorded takes, derive Rhubarb mouth cues, mix audio sample-exactly and report invalidated shots. |
| `performance-prompts` | Compile authored performance phases into timed video prompts bound to a scene timeline. |
| `guide-check` | Verify a guide video's decoded clock and that its padding holds the last delivery frame. |
| `scene-exchange` | Validate a software-independent scene and compile observed views into prompt data. |
| `seam-qa` | Measure every join (look, detail, audio, overlap fidelity) against a local baseline; uncalibrated thresholds give only a provisional PASS; static shots fall back to absolute floors. |
| `stitch` | Frame-exact `assemble` and `retake` (trim + linear blend, one bt709 encode, approved audio copied by packet hash) and `plan-retake` geometry. |
| `window-plan` | Plan generation windows on a model grid with chained checkpoint keys (`plan`), and diff two plans into a re-render scope (`diff`). |
| `prompt-lint` | Static reference, start-image, look, emotion, continuity and take-cap checks over film and performance plans before GPU spend. |
| `art-extract`, `masked-composite`, `planar-art`, `surface-masks`, `surface-graphs` | Artwork extraction, masked repair, planar art compositing, surface masks and their graphs; configs listed in their source headers. |

## Clock (`src/clock.rs`)

`RationalRate` (`25`, `"30000/1001"` or `{"num":30000,"den":1001}`),
`RationalSeconds`, `DurationPolicy` and half-open `FrameInterval`, all in
integer arithmetic. 18 s at 30000/1001 is 539.46 frames: it is refused unless a
policy says how to resolve it.

```json
{"rate": {"num": 30000, "den": 1001}, "duration_s": 18,
 "policy": {"priority": "duration", "rounding": "ceil",
            "allowed_error": {"num": 1001, "den": 30000}}}
```

`priority`: `duration` | `frame_count`. `rounding`: `exact` | `floor` | `ceil` |
`nearest`. `allowed_error` bounds the gap between the requested duration and the
resolved frame count's duration (default none).

## `film-bake` plan (`film-bake/2`)

```json
{"schema": "film-bake/2", "id": "my-film", "status": "provisional",
 "clock": {"rate": 25, "duration_s": 30, "frames": null, "policy": null},
 "resolution": {"width": 1280, "height": 720, "aspect": "16:9"},
 "negative_prompt": "blur, watermark",
 "bindings": {"path": "plans/bindings.json", "sha256": "…"},
 "native_scene": {"path": "…", "sha256": "…"},
 "native_frame_map": null,
 "scene_plan": {"path": "…", "sha256": "…"},
 "render_directory": "renders/native",
 "anchor_template": {"path": "…", "sha256": "…"},
 "video_template": {"path": "…", "sha256": "…"},
 "assets": {"id": {"path": "…", "sha256": "…"}},
 "segments": [{"id": "s01", "frames": [0, 375], "source_frames": [0, 375],
   "beat_ids": ["b01"], "actors": [], "transition": "start",
   "transition_reason": "opening", "references": [],
   "anchor_prompt": {}, "video_prompt": "…"}]}
```

`clock` needs `rate` plus `duration_s` (whole seconds, or `{"num":..,"den":..}` for
fractions such as 18.5 s) or `frames`; `policy` defaults to exact
rounding and zero error. Frame count, rate, canvas and every ffmpeg expression
derive from it. Segment keys also accept `exact_art`, `firstlook_asset`,
`reference_mode`, `reference_attention`, `layout_attention` and `keyframes`.
`native_frame_map` is a hashed `native-frame-map/2` file
(`rate`, `source_frames`, `reason`, `physics_timing_status`).

### Workflow-binding map (`workflow-bindings/1`)

Names which template node plays which role, so no node id is compiled in. A
binding to a missing node or input is an error, never a silently invented node.

```json
{"schema": "workflow-bindings/1",
 "anchor": {"remove_nodes": [], "guide_image_node": "…", "guide_scale_target": "…",
   "prompt_node": "…", "positive_start": "…", "negative_start": "…",
   "vae_node": "…", "conditioning_node": "…", "output_node": "…",
   "reference_megapixels": 0.25},
 "video": {"guide_video_node": "…", "anchor_image_node": "…",
   "positive_prompt_node": "…", "negative_prompt_node": "…", "output_node": "…",
   "layout_guide_nodes": [], "reference_guide_nodes": [], "frame_multiple": 8}}
```

`frame_multiple` is the model's clip quantum (`k * multiple + 1` frames).
`prepare` also requires the native render receipt's rate (`rate` or legacy `fps`)
to equal the plan's. Uploads read each file once, check it against its declared `sha256`, and send
those exact bytes.

## `contract-check`

`contract-check [--require-pass] MANIFEST PACKAGE_ROOT`, schema
`contract-check/1`. Gates and expectations carry a verdict: `PASS`, `FAIL`,
`BLOCKED`, `NOT_RUN`, `NOT_APPLICABLE`.

```json
{"schema": "contract-check/1", "artifacts": [{"id": "A", "path": "doc.md", "status": "ready"}],
 "requirements": [{"id": "R", "expectations": ["E"], "tasks": ["T"], "gates": ["G"]}],
 "expectations": [{"id": "E", "requirement": "R", "category": "x", "regression_critical": false,
   "verification": "NOT_RUN", "tests": [], "reason": null, "evidence": null}],
 "tasks": [{"id": "T", "requires": [], "status": "planned", "implementation_paths": [], "checks": []}],
 "gates": [{"id": "G", "kind": "integration", "automated": true, "verdict": "PASS",
   "evidence": {"path": "out/g.txt", "sha256": "…"}, "reason": null}],
 "adr": null}
```

`PASS` needs evidence that exists inside the root (symlink-safe) with a matching
SHA-256. `FAIL`, `BLOCKED` and `NOT_APPLICABLE` need a `reason`. Task status:
`planned|partial|implemented|verified|blocked|deferred`; `implemented` and
`verified` need existing paths and named checks. ADR status `proposed|accepted|superseded|rejected`;
acceptance needs a 40-hex `verified_commit` and `verified_paths`. The report
gives `valid` (well formed, claims backed) and `passed` (no FAIL/BLOCKED/NOT_RUN,
at least one PASS). Exit 1 if invalid, 2 if `--require-pass` and not passed.
Evidence is checked for existence and hash only; gates are not re-run.

## Other configs

* `render-cache [--root DIR] --allow A..B … PARENT REVISION PATCH WORLD NEW`:
  revision `render-revision/2` (`source_unchanged`, `scope_unchanged`,
  `source_world_sha256`, `world_sha256`, `frames`, `scoped_world_hashes`,
  `changed_frames`); receipts carry `rate` and `frames` list. Parent and patch render receipts give
  their rate as `rate` or the legacy `fps`.
* `review-cut [--root DIR] PLAN NEW_DIR`: `review-cut/2` with
  `clock {rate, frames}`, `resolution {width, height}`, `clips` partitioning the
  frames.
* `dialogue-bake [--root DIR] SESSION OUT [PREVIOUS]`: `dialogue-session/1`
  with `rate` (or integer `fps`), `frames`, `rhubarb_bin`, `cache_dir`, `takes`,
  optional `shots`.
* `performance-prompts [--root DIR] PLAN SCENE_PLAN OUT`: `performance-plan/2`
  adds `guide_instruction`; the scene's `delivery.fps` may be rational.
* `guide-check [--root DIR] VIDEO DELIVERY MODEL RATE RECEIPT`.
* `scene-exchange validate|compile`: `video-scene/1` where `fps` may be rational;
  output `prompt-exchange/2`.
* `planar-art`, `surface-masks`: configs take `rate`, which every upstream
  receipt's `fps` must equal.

## Tests

`cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test && cargo doc --no-deps`.

## Calibration evidence

`calibrated: true` in any threshold set is honoured only with a `threshold-calibration/2` record (`calibration.rs`): `{schema, tool, provenance, thresholds_sha256, evidence:[{path, sha256}]}` (non-empty evidence, every file verified under `--root`). `thresholds_sha256` is the sha256 of the compact, key-sorted JSON of the *effective* threshold object (serde defaults applied) without its `calibrated`/`calibration` fields; the tool recomputes it and refuses any mismatch, so a record cannot back a different or loosened set. Without a matching record the claim is refused. Decode refuses untagged YUV (unless a stitch segment, the `seam-qa` cut, or a `seam-qa` overlap reference declares `colour: {matrix, range}`; a declaration that contradicts any present tag, even a lone range tag, is refused). `stitch assemble` alone reports `acceptance_backing: false`: acceptance needs `seam-qa`. Sources are re-hashed after the encode and a changed one discards the output, HDR, BT.2020, rotation and non-square SAR. `window-plan --model PATH=HEX` re-hashes the file; `--model-hash-unverified` is the escape for weights not on this box. `render-cache --allow-from-diff` requires the parent receipt's `plan_hash` and `plan_final_key` (record them with `--plan`) and both `--old-plan` and `--new-plan`, which re-run the diff; only the new plan's models are compared with disk (the old plan's weights may have been overwritten). Plans are `window-plan/2` (keys `window-key/2`); older plans are refused with a re-plan message.
