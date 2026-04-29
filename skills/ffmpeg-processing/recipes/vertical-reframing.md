# Vertical Reframing (16:9 → 9:16)

For Shorts, TikTok, Reels. Two strategies: pad with letterbox, or pan-and-scan crop.

## Strategy 1: Letterbox (safe, works for any source)

Preserves full content, adds black bars top/bottom.

```bash
ffmpeg -y -i input.mp4 -vf \
  "scale=w=1080:h=1920:force_original_aspect_ratio=decrease,\
pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1:1" \
  -c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p \
  -c:a copy -movflags +faststart \
  output_vertical.mp4
```

`force_original_aspect_ratio=decrease` shrinks until both dimensions fit; `pad` then fills to target with `color=black`. `setsar=1:1` normalises pixel aspect (some downstream tools mis-handle non-square SAR).

## Strategy 2: Pan-and-scan with multi-segment crops

Crops different regions of the source at different times -- e.g. follow the action. Replaces the letterbox bars with full-bleed video.

```bash
ffmpeg -y -i input.mp4 -vf \
  "split=3[a][b][c];\
[a]trim=0:4.5,setpts=PTS-STARTPTS,crop=480:720:300:0,scale=720:1080,setsar=1:1[a];\
[b]trim=4.5:8.5,setpts=PTS-STARTPTS,crop=480:720:500:0,scale=720:1080,setsar=1:1[b];\
[c]trim=8.5,setpts=PTS-STARTPTS,crop=480:720:400:0,scale=720:1080,setsar=1:1[c];\
[a][b][c]concat=n=3:v=1" \
  -c:v libx264 -c:a copy output_panscan.mp4
```

`crop=W:H:X:Y` -- crop a `W×H` region starting at `(X,Y)`. Each segment crops a different X to follow the subject. `concat=n=3:v=1` joins three video segments back to one stream.

If the crop X+W exceeds source width, pad before cropping:

```bash
crop=min(in_w-1200\,480):min(in_h-0\,720):1200:0,\
pad=480:720:(ow-iw)/2:(oh-ih)/2:color=black
```

## Strategy 3: Multi-output single-pass (one decode, two renders)

Generate horizontal YouTube and vertical Shorts versions from one input. Cheaper than two separate ffmpeg invocations because the source decodes once.

```bash
ffmpeg -y -i input.mp4 -i logo.png -filter_complex \
  "[0:v]split=2[s0][s1];\
[s0]scale=w=1920:h=1080:force_original_aspect_ratio=decrease,\
   pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1:1[yt];\
[s1]scale=w=720:h=1280:force_original_aspect_ratio=decrease,\
   pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1:1[v];\
[v][1]overlay=(main_w-overlay_w)/2:(main_w-overlay_w)/5[shorts]" \
  -map "[yt]"     -map 0:a -c:v libx264 -crf 18 youtube.mp4 \
  -map "[shorts]" -map 0:a -c:v libx264 -crf 18 shorts.mp4
```

The vertical output also gets a centred logo overlay near the top. Both outputs reuse the source audio.

## Vertical stack (two videos top/bottom)

Common for reaction/commentary formats.

```bash
ffmpeg -y -i top.mp4 -i bottom.mp4 -filter_complex \
  "[0:v]scale=720:-2:force_original_aspect_ratio=decrease,\
   pad=720:640:(ow-iw)/2:(oh-ih)/2:black[t];\
[1:v]scale=720:-2:force_original_aspect_ratio=decrease,\
   pad=720:640:(ow-iw)/2:(oh-ih)/2:black[b];\
[t][b]vstack=inputs=2:shortest=1[v]" \
  -map "[v]" -map 1:a -c:v libx264 -c:a aac -shortest output_stack.mp4
```

`vstack=shortest=1` ends when the shorter input ends. Outer `-shortest` does the same against the audio map.
