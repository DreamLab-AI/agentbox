# Codebase video sprint

The `codebase-video` skill now produces a narrated explainer with screenshots,
diagrams, Blender animation and locally generated H3 footage. It is registered
for Claude and Codex progressive discovery. The ComfyUI sidecar is a conventional
Docker/pip service, independent of Nix.

The executed sample targets engineering leads assessing Agentbox. Its six-scene
MP4 is 50.813 seconds at 1280 × 720, with H.264 video, AAC narration and selectable
captions. The requested copy is `/home/devuser/workspace/project/explainer.mp4`.
The editable project is `.video-sprint/production-project`; its relative media,
font, workflow and selected source-evidence paths permit local recomposition.

Status: the complete film is rendered, copied and accepted by the user. The final
independent artifact audit verified the hash chain, source snapshots, captions and
audio timing. Automated transcription was supplemented by the user’s positive
review of the delivered video.

## Acceptance evidence

| ID | Requirement | Executed evidence |
|---|---|---|
| V1 | Discovery from Claude and Codex | Both registries and the router include the skill. Isolated Claude reconciliation and the actual Nix derivation's Codex projection resolve it. Current content-addressed inputs are checked against the helpers, references and workflows. Main Agentbox image deployment is not claimed. |
| V2 | Repository and audience grounding | `research.md` maps narration to inspected source and runtime evidence. All 11 scene/source mappings were hash-checked against the repository. The source screenshot is explicitly a read-only registry view; the diagrams and hero are explanatory illustrations. |
| V3 | Working local ComfyUI | Four pinned H3 weights passed SHA256 verification. Both smoke and production prompts completed, with server history and retrieved media hashes. The corrected rebuilt image also passed a fresh H3 smoke execution. |
| V4 | Recoverable agentic harness | Eleven integration tests pass, covering validation, durable submission, observation timeout/resume, terminal failure and output retrieval. Long production observation resumed the same prompt throughout. |
| V5 | Complete media production | All six scenes rendered, with representative frames inspected, valid video/audio/subtitle streams and a full decode check. Independent ASR recovered the final muxed narration. The user accepted the delivered video. |
| V6 | Reusable production helpers | Twelve compositor/narration tests and six downloader tests pass. The actual sample exercises narration timing, all visual kinds, caption muxing and generated-media provenance. |
| V7 | Blender handoff | An editable scene and 189-frame animation were rendered at 24 fps, matching the 7.875-second spoken scene. Beginning, middle and final frames were inspected. |
| V8 | Independent quality audit | A Claude-family auditor exercised counterexamples against the GPT-produced code. Three bugs were fixed and verified: portrait caption overflow, incomplete generation metadata and malformed scene objects. The final artifact audit verified provenance and found stale editorial notes, which were updated after user acceptance. |

## Runtime and model evidence

ComfyUI is pinned to `efa6c8f804bff78b46a0fd458ebd2e47bba07a30`. The corrected
image is `sha256:e4b925acfe209b74869838216319bffea050275072a40d2e7001109df488da93`.
Its isolated probe confirms PyTorch 2.14.0/CUDA 13.0 and installed Python headers.
The service was recreated from that image after the production output had been
retrieved. Persistent model/output volumes were retained.

The first real model job exposed missing `Python.h` during Triton CUDA helper
compilation. Adding `python3-dev` fixed the running service and the Dockerfile.
The successful initial smoke prompt was
`59a12613-2824-45e0-8a99-ce191f32ac89`: 56 frames at 608 × 352 in 36.10 seconds.
The rebuilt image's smoke prompt was `9c445718-af16-4908-a39e-11b9bfaba3d6`.

Production prompt `4784dfe3-1e76-42d6-87dd-5bad5ccf1b81` generated 243 frames at
1344 × 768 (10.125 seconds), taking 1,468.373 seconds on one RTX 6000 Ada. Dynamic
staged loading handled the text encoder, diffusion model and VAEs without an
out-of-memory failure. Two-GPU placement remains an available, untested fallback;
this sample does not establish distributed inference or its performance.

The hero SHA256 is
`397cb5429a899f8a349e1ba9f36bead0613a4922dbab56f33e003a116470e1dc`.
The delivered explainer SHA256 is
`70da6bac9d3f6556aa55206544bf5e21b9fd44d5a6d6d16cdac7626b4f9e9fab`.
Runtime receipts, ffprobe results, source snapshots and editorial records are
retained in the production project and the ignored `.video-sprint` directory.

H3 was selected using its
[official ComfyUI workflow](https://docs.comfy.org/tutorials/video/minimax/minimax-h3)
and current model/community research. LTX-2.3 is an explicit alternative profile;
it was not rendered during this sample and no universal model-ranking claim is
made. The [ComfyUI Agent Kit](https://github.com/SlavaSexton/ComfyUI-Agent-Kit)
informed the workflow inspection and durable harness design; source pins and the
integration decision are documented in the ComfyUI skill references.

## Review limits

The final audit noted 10-pixel sidebars on the hero scene, resulting from the
documented aspect-fit compositor preserving the complete 1344 × 768 source in a
1280 × 720 frame. These are retained in the user-accepted film. It also caught
editorial notes from the earlier preview; those now describe the completed film
and record the user's review. The automated render receipt keeps its original
`rendered-needs-editorial-review` status, with editorial acceptance recorded
separately.

Kokoro-ONNX produced the six narration WAVs. Their durations and signal levels were
measured; faster-whisper independently recovered their words and the final MP4's
muxed speech. This reviewing session cannot receive audio input. The user subsequently reviewed
and accepted the copied film.

The deepsec gate found no issues in the new video code. Its five findings concern
other worktree changes (three MEDIUM and two HIGH_BUG); its policy PASS is not a
clean whole-repository security audit. No unrelated services were removed or
redeployed. Other repository changes were preserved and included at close-out
under the user's explicit instruction.

At close-out, all 105 manifest tests and 19 model-diversity tests passed, as did
shell/JavaScript syntax checks and the 127-skill lint. The user authorised
committing and pushing all outstanding Agentbox changes, including the separate
Codex model-default and manifest-wiring updates. A refreshed deepsec run left five
batches unreviewed after a provider rate limit; its wrapper PASS is not treated as
a complete fresh review. The fallback inherited an unavailable Ollama endpoint
and was stopped. The user explicitly requested close-out without further delay.
