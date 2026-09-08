# Blender shots for codebase explainers

Use Blender when camera movement, depth, assembly, or a spatial relationship helps
explain the repository. Keep the factual labels and topology grounded in source
evidence from the `codebase-video` plan. For ordinary 2D charts, use that skill's
diagram compositor or the existing diagram tools.

Create one editable scene per shot. Match the production frame rate and aspect
ratio; render PNG frames so a failed render can resume from the missing frame.
Preserve `scene.blend`, the script, camera settings, frame range and source claims.
Keep labels in Blender or the compositor; generated footage must not change them.

The bundled example renders three labelled blocks rising in sequence:

```bash
bash tools/blender-batch.sh scripts/explainer_scene.py /absolute/new-shot-dir Repository Agent 'Local tools'
ffmpeg -framerate 24 -i /absolute/new-shot-dir/frame-%04d.png \
  -c:v libx264 -pix_fmt yuv420p /absolute/new-shot-dir/animation.mp4
```

Run those paths from the Blender skill directory. The output directory must be
new. This script uses a fresh Blender process and selects one available CUDA GPU;
it does not edit an existing interactive session. `shot.json` records timing and
camera metadata. The default shot is a starting asset, not a complete explainer.
Adapt its labels, geometry, pacing and dimensions to the actual audience.
Pass `--duration 7.875` to match a measured narration scene; the script scales
the animation keyframes and renders the corresponding frame count at 24 fps.
The default duration is three seconds, with supported durations of 1–60 seconds.

Inspect beginning, middle and final frames, and play the encoded clip. Check text
legibility at delivery size, clipping, camera continuity and animation pacing.
The `codebase-video` scene uses `kind: video` and references the encoded asset;
retain the editable source beside it.

For image-to-video generation, upload a rendered keyframe through ComfyUI's
`/upload/image` endpoint and use the server-returned name in a validated I2V graph.
For controlled motion, use a model-supported reference-video or control workflow.
Check `/object_info` and the official model template before connecting depth or
normal passes: their existence does not mean the chosen model accepts them.
Retrieve generated media over `/view`; the Blender and ComfyUI sidecars do not
share filesystem paths by default.
