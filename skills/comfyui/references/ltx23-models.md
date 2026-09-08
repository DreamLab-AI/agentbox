# LTX-2.3 alternate profile

The alternate explainer hero generator is **LTX-2.3 distilled FP8**, a 22B joint
video/audio model, with the official Comfy-Org Gemma 3 12B FP4 text encoder.
This choice provides current native ComfyUI support and eight-step inference on
our 48 GB GPU. It is a practical default, not a claim that one model leads every
video benchmark. Generated hero footage supplements verified screenshots and
precise diagrams; add factual text and narration during editing.

## Install and verify

Run from the Agentbox repository (or copy the standalone downloader into the
sidecar). The destination is the **ComfyUI models directory**, not its parent:

```bash
python skills/comfyui/scripts/download_video_models.py --profile ltx23 --list
python skills/comfyui/scripts/download_video_models.py --profile ltx23 --models-dir /opt/ComfyUI/models
python skills/comfyui/scripts/download_video_models.py --profile ltx23 --models-dir /opt/ComfyUI/models --verify-only
```

Allow at least 45 GB of free disk for these two weights. The downloader pins
repository revisions, byte sizes and SHA-256 values; it resumes `.part` files,
serialises concurrent writers and publishes only verified files by atomic rename.
Existing final files are rehashed before reuse. Interrupted transfers can be
retried with the same command. No Hugging Face token is required by the public
URLs. Model use remains subject to the publishers' licences; consult their model
cards for distribution or commercial deployment terms.

| Destination | Publisher revision | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `checkpoints/ltx-2.3-22b-distilled-fp8.safetensors` | `Lightricks/LTX-2.3-fp8@1d756cd27fa11c0896c4dfee093cd1bf36c7f7a1` | 29531884062 | `d9646b6f2d5c42d337b23671634c43bfeece6989644f51b4a3aa088465ccd3b2` |
| `text_encoders/gemma_3_12B_it_fp4_mixed.safetensors` | `Comfy-Org/ltx-2@101c239b4b64dd1b45d645365339c56e0e7df4c3` | 9447702218 | `aaca463d11e6d8d2a4bdb0d6299214c15ef78a3f73e0ef8113d5a9d0219b3f6d` |

The checkpoint bundles diffusion weights, video VAE, audio VAE, vocoder and text
projection. Only the separate Gemma encoder is additionally required. Do not
load the complete checkpoint through `UNETLoader`, or substitute an LTX-2 VAE
for the LTX-2.3 VAE.

## API workflows

- [Smoke graph](../workflows/ltx-2.3-t2v-smoke.api.json): 512 × 320, 49 frames,
  24 fps, fixed seed 42, joint generated audio, about 2 seconds.
- [Hero graph](../workflows/ltx-2.3-t2v.api.json): 768 × 448, 121 frames,
  24 fps, about 5 seconds. This is a draft production shot; scale/crop to the
  final canvas during composition and review the rendered motion before delivery.

Both are **API prompt graphs**, not frontend workflow JSON. Submit them under
`{"prompt": <graph>}` to `/prompt`, wait for that exact prompt's `/history/{id}`
terminal result, then retrieve the `SaveVideo` output with `/view`. A queued
prompt is not proof of a successful render. Verify the saved file with ffprobe
and inspect representative frames and motion. Node IDs are stable: positive
prompt `3.text`, dimensions/frame count `6`, audio frame count `8`, seed
`10.noise_seed`, FPS `5.frame_rate`/`8.frame_rate`/`18.fps`, output prefix
`19.filename_prefix`. Change all matching duration/FPS inputs together.

Width and height must be multiples of 32; frame count must be `8n + 1`. These
single-pass distilled graphs use CFG 1 and the official eight-step sigma
schedule. The full template's dev checkpoint, distilled LoRA, prompt-expansion
LoRA and spatial upscaler are intentionally not dependencies of these graphs.
For higher-detail output, use the official two-pass template with its own full
model manifest, or render a larger single-pass shot after the small graph passes.
Do not quietly replace failed model generation with a stock or static clip.

## Authoritative references

- [ComfyUI LTX-2.3 guide](https://docs.comfy.org/tutorials/video/ltx/ltx-2-3)
- [Official UI template](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/video_ltx2_3_t2v.json)
- [Lightricks FP8 model card and weights](https://huggingface.co/Lightricks/LTX-2.3-fp8/tree/1d756cd27fa11c0896c4dfee093cd1bf36c7f7a1)
- [Official Comfy text encoder](https://huggingface.co/Comfy-Org/ltx-2/tree/101c239b4b64dd1b45d645365339c56e0e7df4c3/split_files/text_encoders)
- [Pinned native video/audio node definitions](https://github.com/Comfy-Org/ComfyUI/blob/efa6c8f804bff78b46a0fd458ebd2e47bba07a30/comfy_extras/nodes_lt_audio.py)

Source metadata checked 8 September 2026. Runtime render evidence is maintained
with sprint validation artifacts; the JSON and source checks alone do not
establish successful GPU execution.
