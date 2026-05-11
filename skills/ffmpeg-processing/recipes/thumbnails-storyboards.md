# Thumbnails and Storyboards

Single thumbnails, scene-detected representative frames, tile-grid storyboards, and keyframe-only extracts.

## Single thumbnail at a timestamp

```bash
ffmpeg -y -ss 00:00:07 -i input.mp4 -frames:v 1 -q:v 2 thumb.jpg
```

`-frames:v 1` -- output exactly one video frame.
`-q:v 2` -- JPEG quality 2 (best). Range is 2–31, lower = better.
`-ss` before `-i` is fast input seeking (keyframe-aligned). For exact frame, use output seeking (after `-i`); see [gotchas.md](gotchas.md#input-vs-output-seeking).

## Two thumbnails in one pass

```bash
ffmpeg -y -i input.mp4 -filter_complex \
  "[0:v]split=2[a][b];\
[a]select='gte(t,5)'[t1];\
[b]select='gte(t,15)'[t2]" \
  -map "[t1]" -frames:v 1 -q:v 2 thumb_5s.jpg \
  -map "[t2]" -frames:v 1 -q:v 2 thumb_15s.jpg
```

`split=2` duplicates the stream so two `select` filters can pick different timestamps from a single decode.

## Scene-detected thumbnail (first frame after a cut)

```bash
ffmpeg -y -i input.mp4 -vf "select='gt(scene,0.4)'" -frames:v 1 -q:v 2 thumb.jpg
```

`scene` is a per-frame metric of dissimilarity from the previous frame (0=identical, 1=completely different). `gt(scene,0.4)` matches frames with significant change.

| `scene` threshold | Behaviour                                       |
| ----------------- | ----------------------------------------------- |
| 0.2               | Many false positives (camera shake, lighting)   |
| 0.3               | Aggressive detection -- catches subtle cuts    |
| 0.4               | Balanced                                        |
| 0.5               | Conservative -- only hard cuts                  |

## Tile-grid storyboard from scene changes

```bash
ffmpeg -y -i input.mp4 -vf \
  "select='gt(scene,0.4)',scale=640:480,tile=2x2" \
  -frames:v 1 storyboard.jpg
```

`tile=2x2` packs four selected frames into a 2×2 grid in one image. For 4×4: `tile=4x4`. Output is one JPEG.

If more frames match than the tile holds, FFmpeg writes multiple tiled images:

```bash
ffmpeg -y -i input.mp4 -vf \
  "select='gt(scene,0.4)',scale=640:480,tile=4x4" \
  -fps_mode passthrough storyboard_%03d.jpg
```

`-fps_mode passthrough` (replaces deprecated `-vsync 0`) preserves the irregular cadence of scene-selected frames; without it, FFmpeg pads to the input fps and you'd get duplicated frames in the tiles.

## One image per scene change (no tiling)

```bash
ffmpeg -y -i input.mp4 -vf "select='gt(scene,0.4)'" \
  -fps_mode passthrough scene_%03d.jpg
```

## Keyframe-only storyboard

Keyframes are encoder-chosen reference frames, not scene changes. Useful for very fast extraction (no full decode needed):

```bash
ffmpeg -y -skip_frame nokey -i input.mp4 -vf 'scale=640:480,tile=4x4' \
  -an -fps_mode passthrough keyframes_%03d.png
```

`-skip_frame nokey` -- the demuxer drops non-keyframes before decoding. Much faster than `select` on long files but cadence depends on the encoder's GOP structure (typically ~1 keyframe per 2-10s).

## Every Nth frame as a tile

```bash
ffmpeg -y -i input.mp4 -vf \
  "select=not(mod(n\,10)),scale=640:480,tile=4x2" \
  -fps_mode passthrough sample_%03d.png
```

`not(mod(n,10))` is true when frame index `n` is divisible by 10 -- every 10th frame.

## Composite thumbnail from multiple images

Hero image with two corner inlays:

```bash
ffmpeg -y -i hero.png -i inset1.png -i inset2.png -filter_complex \
  "[1]scale=640:360,pad=648:368:4:4:black[a];\
[2]scale=640:360,pad=648:368:4:4:black[b];\
[0][a]overlay=0:main_h-overlay_h[t];\
[t][b]overlay=main_w-overlay_w:main_h-overlay_h" \
  -frames:v 1 composite.png
```

`pad=648:368:4:4:black` adds a 4-pixel black border around each inset. First overlay anchors bottom-left, second to bottom-right.

## Generate WebVTT preview thumbnails for a video player

Common pattern for hover-scrubber previews on web players:

```bash
# 1. Extract one thumb per 10 seconds, scaled to 160px, tiled 5×5
ffmpeg -y -i input.mp4 -vf "fps=1/10,scale=160:-1,tile=5x5" \
  -fps_mode passthrough sprite_%03d.jpg
```

Then generate a `.vtt` file mapping timestamps to sprite coordinates -- typically a separate script.
