# Intro + Main + Outro with Background Music

Concatenating clips that may have different framerates, sample rates, or channel layouts -- and overlaying a faded music bed.

## The core problem

`concat` filter requires matching `timebase`, `sample_aspect_ratio`, `pixel format`, audio `sample_fmt`, `sample_rate`, `channel_layout` across every input. Mismatches produce silent failure or A/V drift. Always normalise before concat.

## Three-clip concat with normalised formats and BGM

```bash
ffmpeg -y \
  -i intro.mp4 -i main.mp4 -i outro.mp4 -i music.mp3 \
  -filter_complex \
  "[0:v]fps=30,format=yuv420p,setsar=1[iv];\
[1:v]scale=-2:720:force_original_aspect_ratio=decrease,\
   pad=1280:720:(ow-iw)/2:(oh-ih)/2:black,\
   fps=30,format=yuv420p,setsar=1[mv];\
[2:v]fps=30,format=yuv420p,setsar=1[ov];\
[0:a]aformat=sample_fmts=fltp:channel_layouts=stereo[ia];\
[1:a]aformat=sample_fmts=fltp:channel_layouts=stereo[ma];\
[2:a]aformat=sample_fmts=fltp:channel_layouts=stereo[oa];\
[iv][ia][mv][ma][ov][oa]concat=n=3:v=1:a=1[v][a];\
[3:a]volume=0.1,aformat=sample_fmts=fltp,\
   afade=t=in:ss=0:d=1.5,afade=t=out:st=20:d=2[bgm];\
[a][bgm]amix=inputs=2:duration=first:dropout_transition=2[final_a]" \
  -map "[v]" -map "[final_a]" \
  -c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p \
  -c:a aac -b:a 192k -movflags +faststart -shortest \
  output.mp4
```

### What each block does

| Block | Purpose |
|---|---|
| `fps=30,format=yuv420p,setsar=1` | Force matching framerate, pixel format, and pixel aspect on each video |
| `scale...pad...` (main only) | Resize to canonical 1280×720 with letterbox for off-spec source |
| `aformat=sample_fmts=fltp:channel_layouts=stereo` | Force matching audio format (32-bit float planar stereo) |
| `concat=n=3:v=1:a=1` | Join 3 video streams + 3 audio streams |
| `volume=0.1` | BGM at 10% so the dialogue isn't drowned |
| `afade=t=in:ss=0:d=1.5` / `afade=t=out:st=20:d=2` | BGM fades in over 1.5s, fades out over 2s starting at t=20s |
| `amix=inputs=2:duration=first:dropout_transition=2` | Mix concat audio with BGM; `duration=first` clips to the concat track length, `dropout_transition=2` smooths the BGM ending |

## Cheaper concat with `-f concat`

If clips already share codec, framerate, timebase, sample rate, and channel layout, skip the filter graph entirely:

```bash
# list.txt:
#   file 'intro.mp4'
#   file 'main.mp4'
#   file 'outro.mp4'
ffmpeg -y -f concat -safe 0 -i list.txt -c copy joined.mp4
```

This is a remux (no re-encode). If any clip diverges from the others, the output desyncs or fails -- use the filter-graph form above instead.

## Adding BGM to an already-concatenated video

```bash
ffmpeg -y -i video.mp4 -i music.mp3 -filter_complex \
  "[1:a]volume=0.15,afade=t=in:ss=0:d=1.5,afade=t=out:st=58:d=2[bgm];\
[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=2[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k output.mp4
```

`-c:v copy` keeps video re-mux-only; only the audio re-encodes.

## Replace audio entirely (no mixing)

```bash
ffmpeg -y -i video.mp4 -i replacement.mp3 \
  -map 0:v -map 1:a -shortest -c:v copy -c:a aac output.mp4
```

`-shortest` ends at whichever stream is shorter -- the trimmed video may end mid-frame; if you need a clean cut, re-encode (drop `-c:v copy`).
