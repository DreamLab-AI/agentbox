# Local explainer video models

**MiniMax H3 is the primary profile** for this sprint. Its July 2026 release
supports local joint video and stereo audio generation, and current native
ComfyUI templates include reduced-precision weights suitable for evaluating on
our 48 GB GPU. Treat model quality as something to verify against the nominated
audience and shots, not an unconditional benchmark ranking. The explicit
[alternate LTX-2.3 profile](ltx23-models.md) provides eight-step generation.

## Download and verify

```bash
python skills/comfyui/scripts/download_video_models.py --profile h3 --list
python skills/comfyui/scripts/download_video_models.py --profile h3 --models-dir /opt/ComfyUI/models
python skills/comfyui/scripts/download_video_models.py --profile h3 --models-dir /opt/ComfyUI/models --verify-only
```

The standalone standard-library downloader pins byte sizes, SHA-256 hashes and
publisher revisions. It serialises concurrent writers, resumes `.part` transfers,
rehashes existing files and atomically renames only verified downloads. Allow
at least 50 GB free disk for H3's 42.47 GB manifest. Do not download the roughly
498 GB full upstream repository for this profile. Public weight URLs do not
require a token; consult publisher model cards for licence conditions.

All four files below come from `Comfy-Org/MiniMax-H3` revision
`a98869194787969724c7425d95d0ed73ce9202af`; full immutable hashes are in
`skills/comfyui/scripts/download_video_models.py --list` output.

| ComfyUI models path | Bytes |
| --- | ---: |
| `diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors` | 20970379616 |
| `text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` | 15687142551 |
| `vae/minimax_h3_audio_vae_fp32.safetensors` | 605254808 |
| `vae/minimax_h3_video_vae_fp16.safetensors` | 5207808496 |

See [GPU compatibility and reference conditioning](h3-compatibility.md) for
CUDA 13 kernel requirements, Ampere/Ada FP4 fallback, and I2V/R2V weights.

## API graphs

- [Smoke](../workflows/minimax-h3-t2v-smoke.api.json): 608 × 352, 56 frames,
  24 fps, 20 steps. This deliberately short clip proves execution only; it is
  below the model's trained duration range and does not prove production quality.
- [Production hero](../workflows/minimax-h3-t2v.api.json): 1344 × 768,
  124 frames, 24 fps, 20 steps, fixed seed 42. Review a complete shot at this
  scale before delivering the explainer.

Both are API prompt graphs, not UI workflow files. Submit under
`{"prompt": <graph>}` to `/prompt`, poll that exact ID's `/history/{id}`, reject
error status, retrieve the recorded SaveVideo output with `/view`, then use
ffprobe and visual inspection to verify it. A submission receipt is not a
render result. The ComfyUI MCP harness provides the equivalent queue/history
operations. Keep the model-generated footage separate from factual screenshots,
diagrams, titles and narration during editing.

Stable edit points: node `5.prompt`, `5.width`, `5.height`, `5.length`,
`6.noise_seed`, `9.steps` and `14.filename_prefix`. H3 renders at 24 fps. Width
and height are multiples of 32; frame count follows `17k + 5`. The native
training range is approximately 124–362 frames (5–15 seconds). The image-to-video
node also performs text-to-video when no keyframe input is connected. For I2V,
upload a verified image, add `LoadImage`, and connect its image output to
`5.first_frame`; `5.last_frame` is optional.

These graphs follow the official baseline: `res_multistep`, `simple` scheduler,
20 steps, `BasicGuider`, no turbo LoRA, and the joint sampler output fed to both
video and audio VAEs. The optional community LightX2V turbo LoRA requires a
separate download and matching 8-step configuration; do not lower baseline steps
to 8 without loading it. Quantisation labels describe stored weights; runtime
kernel support and actual peak VRAM must be tested on the deployed GPU.

## Image and reference-conditioned shots

- [I2V API graph](../workflows/minimax-h3-i2v.api.json): baseline `h3` weights,
  first-frame conditioning, 1344 × 768, 124 frames, 20 steps.
- [R2V API graph](../workflows/minimax-h3-r2v.api.json): optional `h3-reference`
  weights, one image reference, `match` sizing and `beta` scheduler, same canvas.

Upload the chosen image to ComfyUI `/upload/image`, then set node `15.image` to
its returned filename, including returned subfolder when present. The checked-in
`reference.png` is a placeholder and must be replaced with that actual upload
result. Both graphs use node `5.prompt`, seed `6.noise_seed` and output
`14.filename_prefix`. R2V's image is connected with the native autogrow API key
`5.inputs["ref_images.ref_image_0"]`; refer to it as `<Picture 1>` in the prompt.
The template graphs use the full trained duration; use `length=56` only for an
explicitly labelled smoke test. Execute T2V first, then I2V, then evaluate R2V.

```bash
python skills/comfyui/scripts/download_video_models.py --profile h3-reference --list
python skills/comfyui/scripts/download_video_models.py --profile h3-reference --models-dir /opt/ComfyUI/models
```

This optional profile re-verifies/skips the four shared H3 weights and adds only
`diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors`
(20970379616 bytes, SHA-256
`9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779`, same pinned
Comfy-Org revision). It needs about 21 GB additional disk. It is not downloaded
by the default `h3` profile.

## Sources and verification scope

- [Official MiniMax H3 announcement](https://www.minimax.io/blog/minimax-h3)
- [Official ComfyUI H3 guide](https://docs.comfy.org/tutorials/video/minimax/minimax-h3)
- [Comfy-Org pinned weights](https://huggingface.co/Comfy-Org/MiniMax-H3/tree/a98869194787969724c7425d95d0ed73ce9202af)
- [Pinned native H3 node definitions](https://github.com/Comfy-Org/ComfyUI/blob/efa6c8f804bff78b46a0fd458ebd2e47bba07a30/comfy_extras/nodes_minimax_h3.py)
- [Community turbo weights](https://huggingface.co/lightx2v/Minimax-h3-Turbo)

Manifest metadata and node schemas checked on 8 September 2026. GPU execution,
production shot review and final composed-video evidence belong in the sprint
validation artifacts; source inspection alone does not establish those results.
