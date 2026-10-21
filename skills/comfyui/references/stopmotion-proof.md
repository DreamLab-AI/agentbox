# Blender-to-video stop-motion evaluation

Use the Blender skill's `scripts/stopmotion_scene.py` through `blender-job.js` to
build a reproducible puppet, stepped hand/mouth animation and endpoint PNGs.
It saves a `.blend` and a 25 fps shot schedule in the shared job directory.
These mouth cues are a fixture, not speech alignment.

Start with the existing H3 FL2VA profile and native `MiniMaxH3ImageToVideo`
first/last image inputs. Upload images over `/upload/image`; use the returned
names in `LoadImage`, validate against live `/object_info`, and submit with
`comfy_client.py --url http://comfyui:8188`. Pass the URL explicitly when the
calling environment overrides `COMFYUI_URL`.

The optional `h3-clay` downloader profile pins the community clay LoRA and
re-verifies the shared H3 weights. Apply it through `LoraLoaderModelOnly` to
both guider and scheduler model inputs; compare with an identical baseline.
The LoRA learns appearance, not a guaranteed stop-motion cadence.

H3 generates at 24 fps. Retain the native result and evaluate time-preserving
25 fps conform separately; setting CreateVideo to 25 changes duration. A short
608×352, 56-frame smoke is below the trained duration and proves transport and
execution only. Follow with trained-duration, production-resolution shots,
layout/guide adherence, actual voice alignment and sharpness checks.

Keep durable receipts and downloaded media outside the skill tree. Resume the
same prompt ID after observation timeouts. Never treat submission as completion.

Before further generation, use the [model preparation guide](../../../docs/developer/media-model-preparation.md) and the pinned `models/stopmotion-candidates.json` profiles. Plan all components before starting new tests.
