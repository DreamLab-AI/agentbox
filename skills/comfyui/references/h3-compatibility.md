# H3 GPU compatibility and reference workflows

Source audit: 8 September 2026, ComfyUI
`efa6c8f804bff78b46a0fd458ebd2e47bba07a30`, comfy-kitchen `0.2.33`
(source tree `21003fa97bf3b180393446d729ae630ceb6c2a52`). This audit establishes
code paths; successful production inference still requires the actual GPU test.

## CUDA and quantisation

The pinned `comfy/quant_ops.py` disables the comfy-kitchen CUDA backend when
`torch.version.cuda < 13`. Triton is also disabled by default unless explicitly
enabled. Consequently torch 2.8 with CUDA 12.9 does not use the intended kitchen
CUDA kernels. Use a compatible **cu130 or newer PyTorch build** for the optimised
INT8 path; a torch 2.10+ cu130 release is an appropriate version family to pin.
The native H3 node itself does not assert torch >= 2.10. Do not describe 2.10 as
an unconditional H3 architecture requirement: the material gate found is CUDA
13 for this version of kitchen integration.

| Hardware | INT8 ConvRot | NVFP4 encoder |
| --- | --- | --- |
| RTX A6000, SM 8.6 | Supported INT8 compute path | Emulated, no native FP4 tensor cores |
| RTX 6000 Ada, SM 8.9 | Supported INT8 compute path | Emulated, no native FP4 tensor cores |

`supports_nvfp4_compute()` requires NVIDIA compute capability major >= 10.
`pick_operations()` marks NVFP4 disabled on both listed GPUs, selecting
`_full_precision_mm`; `forward_comfy_cast_weights()` explicitly dequantises that
layer before its ordinary linear operation. AWQ input smoothing is still
applied. This preserves compact stored weights but adds computation and temporary
memory. Updating CUDA does not create native FP4 support on Ampere or Ada.

If kitchen CUDA is disabled, the eager INT8 implementation can still perform
ConvRot activation rotation plus `torch._int_mm`. It does **not** necessarily
upcast the whole INT8 diffusion model to BF16. This fallback is slower and must
not be reported as accelerated kitchen execution. Capture the startup backend
report, torch/CUDA versions, GPU model, runtime and peak memory with render
results. ComfyUI pins `comfy-kitchen==0.2.33` in requirements; keep that dependency
rather than an older sidecar package.

Sources:

- [ComfyUI backend gates](https://github.com/Comfy-Org/ComfyUI/blob/efa6c8f804bff78b46a0fd458ebd2e47bba07a30/comfy/quant_ops.py)
- [Hardware format checks](https://github.com/Comfy-Org/ComfyUI/blob/efa6c8f804bff78b46a0fd458ebd2e47bba07a30/comfy/model_management.py)
- [Layer fallback and AWQ smoothing](https://github.com/Comfy-Org/ComfyUI/blob/efa6c8f804bff78b46a0fd458ebd2e47bba07a30/comfy/ops.py)
- [Kitchen eager INT8 implementation](https://github.com/Comfy-Org/comfy-kitchen/blob/21003fa97bf3b180393446d729ae630ceb6c2a52/comfy_kitchen/backends/eager/quantization.py)

## Reference-conditioned footage

The [official I2V template](https://github.com/Comfy-Org/workflow_templates/blob/7c25a3c586484601f94b7e8f8b14c23b2c95a096/templates/video_minimax_h3_i2v.json)
uses the same `fl2va` diffusion weights as our text-to-video graph. Connect a
rendered Blender shot or screenshot to `MiniMaxH3ImageToVideo.first_frame`; an
optional last frame anchors the endpoint. The first frame is stretched to the
canvas; the last is cover-cropped. Prepare matching aspect ratios beforehand.
There are also official continuation and multiframe-reference templates.

The [official R2V template](https://github.com/Comfy-Org/workflow_templates/blob/7c25a3c586484601f94b7e8f8b14c23b2c95a096/templates/video_minimax_h3_r2v.json)
requires **different diffusion weights**,
`minimax_h3_ref2va_pruned_int8_convrot.safetensors`; they are available through the optional `h3-reference` downloader profile
and are not part of the baseline `h3` profile. Keep the same encoder and VAEs, but do not pass
reference conditioning to the fl2va checkpoint and claim equivalent behaviour.

`MiniMaxH3ReferenceToVideo` accepts up to nine images, three videos with optional
paired soundtracks, and three standalone audio clips. Refer to inputs by
`<Picture 1>`, `<Video 1>` and `<Audio 1>` in connection order. Use
`ref_image_size=match` to bound reference tokens; `max` preserves up to a 2048px
short edge and may be several times slower. Supply video/audio VAEs for latent
reference conditioning; omitting them limits those references to the encoder.
The official template favours `beta` or `normal` schedules over `simple` for
reference-heavy prompts. Preserve authoritative UI text as a separate editing
layer even when a model uses screenshots as visual references.
