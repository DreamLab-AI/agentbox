# Timed Text Overlays

`drawtext` filter for static or fading captions, lower-thirds, watermarks. For full styled subs, prefer [styled-subtitles.md](styled-subtitles.md); for arbitrary animated graphics, render PNG sequences and `overlay`.

## Three timed captions with fade-in alpha

```bash
ffmpeg -y -i input.mp4 -vf \
  "drawtext=text='Get ready':x=50:y=100:fontsize=80:fontcolor=black:\
   alpha='if(gte(t,1)*lte(t,3),(t-1)/2,1)':box=1:boxcolor=#6bb666@0.6:boxborderw=7:enable='gte(t,1)',\
drawtext=text='Set':x=50:y=200:fontsize=80:fontcolor=black:\
   alpha='if(gte(t,6)*lte(t,10),(t-6)/4,1)':box=1:boxcolor=#6bb666@0.6:boxborderw=7:enable='gte(t,6)',\
drawtext=text='BOOM!':x=50:y=300:fontsize=80:fontcolor=black:\
   alpha='if(gte(t,10)*lte(t,15),(t-10)/5,1)':box=1:boxcolor=#6bb666@0.6:boxborderw=7:enable='gte(t,10)'" \
  -c:v libx264 output.mp4
```

### Anatomy

| Param | Meaning |
|---|---|
| `text=` | Literal string. Escape special chars. For complex text use `textfile=` instead. |
| `x`, `y` | Pixel position. Expressions allowed: `(w-text_w)/2` to centre, `h-th-50` for bottom margin. |
| `fontsize`, `fontcolor` | Self-explanatory. `fontcolor` accepts `0xRRGGBB`, named colours, or `@alpha` suffix. |
| `box=1` | Draw a background box behind the text. |
| `boxcolor=#6bb666@0.6` | Box fill colour with 60% opacity. |
| `boxborderw=7` | Padding inside the box (px). |
| `enable='gte(t,1)'` | Only render the filter when `t >= 1` second. Frames before t=1 skip this drawtext entirely. |
| `alpha='if(gte(t,1)*lte(t,3),(t-1)/2,1)'` | Animate transparency: between t=1 and t=3, alpha ramps `0 → 1` (fade-in over 2s); after t=3, hold at 1. |

`enable=` and `alpha=` together give clean fade-in + permanent display. For fade-in **and** fade-out, build a piecewise alpha:

```
alpha='if(lt(t,1),0, if(lt(t,3),(t-1)/2, if(lt(t,8),1, if(lt(t,10),(10-t)/2, 0))))'
```

That fades in 1→3s, holds 3→8s, fades out 8→10s.

## Use `textfile=` for safer text

The shell mangles quotes, colons, commas, and newlines inside `text=`. Move long or special-character text to a file:

```bash
ffmpeg -y -i input.mp4 -vf \
  "drawtext=textfile=caption.txt:fontfile=Poppins-Regular.ttf:\
   x=50:y=100:fontsize=40:fontcolor=black:\
   alpha='if(gte(t,1)*lte(t,5),t-1,1)':\
   box=1:boxcolor=#6bb666@0.6:boxborderw=7:enable='gte(t,1)'" \
  -c:v libx264 output.mp4
```

`fontfile=` accepts a local path. FFmpeg does **not** download the file -- fetch it first.

## Logo / watermark with `overlay`

Static, with time gating:

```bash
ffmpeg -y -i input.mp4 -i logo.png -filter_complex \
  "overlay=x=(main_w-overlay_w)/8:y=(main_h-overlay_h)/8:enable='gte(t,1)*lte(t,7)'" \
  -c:v libx264 -c:a copy output.mp4
```

Logo appears at 1s, disappears at 7s. Position is 1/8 in from top-left.

### Forcing partial transparency on an opaque logo

If the source PNG has no alpha, build alpha procedurally:

```bash
ffmpeg -y -i input.mp4 -i logo.png -filter_complex \
  "[1:v]format=argb,geq='p(X,Y)':a='0.5*alpha(X,Y)'[v1];\
[0:v][v1]overlay=x=(main_w-overlay_w)/8:y=(main_h-overlay_h)/8:enable='gte(t,1)*lte(t,7)'" \
  -c:v libx264 -c:a copy output.mp4
```

`format=argb` ensures an alpha channel exists. `geq` rewrites pixel values: `'p(X,Y)'` keeps RGB; `a='0.5*alpha(X,Y)'` halves alpha. Result: 50%-transparent logo regardless of source.

### Common overlay positions

| Position | x, y |
|---|---|
| Top-left, padded | `x=20:y=20` |
| Top-right | `x=main_w-overlay_w-20:y=20` |
| Bottom-right | `x=main_w-overlay_w-20:y=main_h-overlay_h-20` |
| Centre | `x=(main_w-overlay_w)/2:y=(main_h-overlay_h)/2` |
| Centre, top third | `x=(main_w-overlay_w)/2:y=(main_h-overlay_h)/3` |

## Composite over a still background

Place a 16:9 video onto a 9:16 still backdrop -- common for vertical podcast clips:

```bash
ffmpeg -y -i video.mp4 -i background.png -filter_complex \
  "[1:v][0:v]overlay=(W-w)/2:(H-h)/2" \
  -c:v libx264 -c:a copy output.mp4
```

`[1:v][0:v]` -- background first (becomes the canvas), video on top. `(W-w)/2:(H-h)/2` centres the video in the canvas. Capital `W,H` refer to the first input in the filter (the background); lowercase to the second.
