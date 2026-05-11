# Gotchas

The traps that bite in production. Most are documented obscurely or only surface under specific source/codec combinations.

## Input vs output seeking

Position of `-ss` relative to `-i` changes everything.

| Form | Speed | Accuracy | Risk |
|------|-------|----------|------|
| `ffmpeg -ss 10 -i in.mp4 ...` | Fast (jumps by keyframe) | Aligned to nearest keyframe before `10s` | Black frames or A/V drift if combined with `-c copy` |
| `ffmpeg -i in.mp4 -ss 10 ...` | Slower (decodes and discards) | Frame-accurate | Re-encode required for clean cut |

For **archival or social-media trimming**, use output seeking and re-encode:

```bash
ffmpeg -y -i input.mp4 -ss 00:00:10 -to 00:00:30 output.mp4
```

For **fast keyframe-aligned slicing of large files** (e.g. preview generation, batch jobs that tolerate ±a few seconds):

```bash
ffmpeg -y -ss 00:00:10 -to 00:00:30 -i input.mp4 -c copy output.mp4
```

The fast form with `-c copy` is the source of the famous "black frames at the start of my trim" bug. Workaround: re-encode the first GOP only, or accept a slightly later in-point at the next keyframe.

Open FFmpeg issue: trimming with input seeking + `-c copy` can produce malformed output for some codecs. If hit, switch to output seeking.

## When `-c copy` breaks

`-c copy` remuxes streams without re-encoding -- fast and lossless. It silently misbehaves when:

- **A filter is applied** (`-vf`, `-af`, `-filter_complex` that touches the stream): filters require decode + encode. `-c copy` is ignored or causes errors.
- **Cut points aren't on keyframes**: stream copy can only cut at keyframes. Trimming between them produces black frames or playback hiccups.
- **Containers have incompatible codec params**: e.g. copying H.264 into a container that needs different bitstream framing. Symptoms: file plays in some players, fails in others.
- **Audio mix or modify**: any `amix`, `atempo`, `volume`, channel remap forces re-encode.
- **Subtitles burn-in**: rasterising subs into video requires re-encode of video.

Rule: if you're doing anything more than "wrap the same bytes in a different container," drop `-c copy` (or use `-c:v copy -c:a aac` to copy only the unmodified stream).

## Apple/iOS H.265 playback fails without `hvc1` tag

By default `libx265` writes the `hev1` codec tag. iOS and macOS expect `hvc1` for hardware decode. Files play silently or with garbled video without it.

```bash
ffmpeg -y -i input.mp4 -c:v libx265 -tag:v hvc1 -c:a copy output.mp4
```

(Older docs use `-vtag hvc1` -- same thing.)

## QuickTime / older players need `yuv420p`

H.264 supports many pixel formats (4:2:0, 4:2:2, 4:4:4, 10-bit, etc.) but most consumer players only handle 8-bit 4:2:0. If your source is from a phone, GoPro, or recent camera, output may default to a format like `yuv422p` and fail on QuickTime/iOS.

```bash
ffmpeg -y -i input.mp4 -c:v libx264 -pix_fmt yuv420p -c:a copy output.mp4
```

Always include `-pix_fmt yuv420p` for delivery to consumer playback. Skip it only when targeting prosumer pipelines that support higher chroma.

Equivalent inside `-vf`: `format=yuv420p`.

## `-vsync` is deprecated

Old: `-vsync 0` (passthrough, drop duplicate frames)
New: `-fps_mode passthrough`

Other modes:

| Old | New | Behaviour |
|-----|-----|-----------|
| `-vsync 0` | `-fps_mode passthrough` | Pass each frame through, irregular cadence |
| `-vsync 1` | `-fps_mode cfr` | Constant frame rate, duplicate or drop as needed |
| `-vsync 2` | `-fps_mode vfr` | Variable frame rate, drop dupes only |
| `-vsync drop` | `-fps_mode drop` | Drop timestamps; muxer regenerates them |

Required when extracting frames from a `select` filter (irregular timestamps would otherwise be padded with duplicates).

## `concat` filter requires matching stream params

Source clips must agree on: timebase, pixel format, sample aspect ratio, audio sample format, sample rate, channel layout. Mismatches produce silent corruption (A/V drift, dropped frames, black flashes).

Always normalise before concat:

```
[0:v]fps=30,format=yuv420p,setsar=1[v0];
[0:a]aformat=sample_fmts=fltp:channel_layouts=stereo[a0];
... same for each input ...
[v0][a0][v1][a1]...concat=n=N:v=1:a=1
```

See [intro-main-outro.md](intro-main-outro.md) for the full pattern.

## `concat` demuxer (`-f concat`) is stricter than the filter

```
ffmpeg -f concat -safe 0 -i list.txt -c copy out.mp4
```

This requires inputs share **exact codec params** -- not just compatible streams. Files re-encoded with the same `-crf` from different sources often fail because of subtle differences (e.g. slight resolution change, different SAR). When in doubt, use the `concat` filter.

## `force_original_aspect_ratio=decrease` then `pad`

The most common source of "stretched" output. `scale=W:H` alone forces both dimensions, distorting aspect. The correct form:

```
scale=W:H:force_original_aspect_ratio=decrease,
pad=W:H:(ow-iw)/2:(oh-ih)/2:color=black,
setsar=1:1
```

`decrease` shrinks until both dimensions fit inside `W×H`. `pad` then centres in the target box. `setsar=1:1` normalises pixel aspect (some downstream tools render non-square SAR incorrectly).

## `-shortest` doesn't always do what you'd expect with `-c copy`

When mixing `-c copy` with `-shortest`, the output sometimes runs longer than the shortest input. The reason: `-c copy` cuts only at keyframes, so the trim point lands later than the audio end.

If exact length matters, re-encode video at the end (drop `-c copy`) or use output seeking with `-t`.

## `-y` / `-n`

Without either, FFmpeg prompts on overwrite -- which deadlocks any non-interactive pipeline. Always include `-y` (overwrite) in automation.

## Loop over remote URL re-fetches every frame

```
ffmpeg -loop 1 -t 10 -i https://example.com/img.png ...
```

Slow and wasteful -- FFmpeg may re-download the image per-frame. Always download the image locally first when looping.

## `select` filter does not reset timestamps

After `select=...` the surviving frames keep their original timestamps. Without `setpts=N/FRAME_RATE/TB` (or similar), downstream filters and muxers see gaps and may pad or fail.

Pattern:

```
select='gt(scene,0.4)',setpts=N/FRAME_RATE/TB
```

For audio: `aselect=...,asetpts=N/SR/TB`.

## `amix` halves volume on every input

Default behaviour: each input's level is `1/N` where N is the number of inputs. Two inputs of normal volume → output sounds muted.

Workarounds:

- Pre-boost with `volume`: `[0:a]volume=2[a0];[a0][1:a]amix=inputs=2`
- Use `weights`: `amix=inputs=2:weights='1 0.3'` -- explicit per-input gains, no normalisation
- Use `dynaudnorm` after amix to bring level back up

## `atempo` range is 0.5-2.0 per stage

To slow down by 4× or speed up by 4×, chain two stages:

```
atempo=2.0,atempo=2.0    # 4× faster
atempo=0.5,atempo=0.5    # 4× slower
```

## Unicode in `text=` of drawtext

Special chars (`:`, `,`, `'`, `"`, `\`) need escaping inside the filter string. The shell adds another layer. For anything beyond ASCII alphanumerics + spaces, use `textfile=path/to/file.txt` instead.
