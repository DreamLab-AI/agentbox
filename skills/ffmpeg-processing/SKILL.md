---
name: ffmpeg-processing
description: Professional video and audio processing - transcode, edit, stream, and analyze media files
---

# FFmpeg Processing Skill

FFmpeg 8.0 for video/audio transcoding, editing, streaming, and analysis. The recipes/ directory holds production-grade compound commands for automation pipelines; this file is the quick-reference index.

## Capabilities

- Video/audio transcoding and format conversion
- Stream extraction and muxing
- Video editing (cut, concat, filters, reframing)
- Resolution and codec conversion (CPU + CUDA/QSV)
- Subtitle handling (burn-in styled, embedded tracks)
- Streaming protocols (HLS, DASH, RTMP)
- Image-to-video, slideshows, Ken Burns
- Audio processing, mixing, normalisation
- Scene-detected thumbnails and storyboards

## When to Use

- Convert media formats
- Reframe horizontal video for vertical (Shorts/TikTok/Reels)
- Compose intro+main+outro with background music
- Burn styled subtitles or timed text overlays
- Generate thumbnails, storyboards, GIFs
- Build streaming manifests
- Multi-output single-pass encoding

## When Not To Use

- Still image processing -- use `imagemagick`
- AI-generated images/video from text -- use `comfyui`
- 3D rendering and scene creation -- use `blender`
- Diagrams or charts -- use `mermaid-diagrams` or `report-builder`
- Browser-based playback testing -- use `playwright` or `browser`

## Recipe Index

For production patterns (most automation tasks land here), open the matching recipe:

| Recipe | Use when |
|---|---|
| [recipes/vertical-reframing.md](recipes/vertical-reframing.md) | Reframe 16:9 → 9:16 with pan-and-scan, multi-output (YT + Shorts in one pass) |
| [recipes/kenburns-slideshow.md](recipes/kenburns-slideshow.md) | Image → video, slideshows with `xfade`, Ken Burns `zoompan` |
| [recipes/intro-main-outro.md](recipes/intro-main-outro.md) | Concat clips with normalised formats, background music with fade and `amix duration=first` |
| [recipes/styled-subtitles.md](recipes/styled-subtitles.md) | Burn styled SRT with custom font, embed soft subs with default disposition |
| [recipes/timed-text-overlays.md](recipes/timed-text-overlays.md) | `drawtext` with `alpha=if(...)` fade-in, `enable=` time gating, `textfile`/`fontfile` |
| [recipes/audio-mixing.md](recipes/audio-mixing.md) | Replace/mix audio, crossfades, mono panning, dynamic normalisation |
| [recipes/thumbnails-storyboards.md](recipes/thumbnails-storyboards.md) | Scene-detected thumbnails, `tile=NxM` storyboards, keyframe-only extracts |
| [recipes/gotchas.md](recipes/gotchas.md) | Input vs output seeking, `-c copy` traps, `hvc1` for Apple H.265, `yuv420p` for QuickTime, `-vsync` deprecation |
| [recipes/gpu-encoding.md](recipes/gpu-encoding.md) | NVENC, Intel QSV, VAAPI matrix and tradeoffs |

## Stream Selector Glossary

Foundation for everything else.

| Syntax | Meaning |
|---|---|
| `[0:v]` | Video stream from first input |
| `[1:a]` | Audio stream from second input |
| `0:v:0` | First video stream of first input (0-indexed) |
| `0:a:1` | Second audio stream of first input |
| `[name]` | Named filter output (used inside `-filter_complex`) |
| `-map [name]` | Route a named stream to output |
| `-map 0:v -map 1:a` | Take video from input 0, audio from input 1 |
| `-vf` / `-af` | Simple video / audio filter chain (one input, one output) |
| `-filter_complex` | Multi-input/output filter graph |
| `-y` | Auto-overwrite output (put at start of every command) |

## Quick Reference

### Info and Analysis
```bash
ffmpeg -i input.mp4                      # Show file info
ffprobe -v quiet -print_format json -show_format -show_streams input.mp4

# Duration / resolution / bitrate
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 input.mp4
ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 input.mp4
ffprobe -v error -show_entries format=bit_rate -of default=noprint_wrappers=1:nokey=1 input.mp4
```

### Format Conversion
```bash
ffmpeg -y -i input.avi output.mp4              # Re-encode
ffmpeg -y -i input.mp4 -c copy output.mkv      # Remux (no re-encode, fast)
```

### Resolution with aspect-ratio preservation
The correct production form -- preserves aspect, pads black, normalises SAR:
```bash
ffmpeg -y -i input.mp4 -vf \
  "scale=w=1920:h=1080:force_original_aspect_ratio=decrease,\
pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1:1" \
  output.mp4
```
For naive scaling without padding (only when source aspect already matches):
```bash
ffmpeg -y -i input.mp4 -vf scale=-2:720 output.mp4
```

### Quality and bitrate
```bash
ffmpeg -y -i input.mp4 -c:v libx264 -crf 18 -preset veryslow output.mp4   # Archive quality
ffmpeg -y -i input.mp4 -b:v 2M -b:a 192k output.mp4                       # Fixed bitrate
```
CRF: 0 lossless, 17-18 visually lossless, 23 default, 28+ small/lossy. ±6 ≈ ½× or 2× filesize.

### Extract audio
```bash
ffmpeg -y -i video.mp4 -vn -acodec libmp3lame -q:a 2 audio.mp3   # MP3 high quality
ffmpeg -y -i video.mp4 -vn -c:a copy audio.aac                   # AAC remux (fastest)
ffmpeg -y -i video.mp4 -map 0:a:0 -acodec copy audio.aac         # Specific stream
```

### Extract frames
```bash
ffmpeg -y -i input.mp4 frame%04d.png                                       # All
ffmpeg -y -i input.mp4 -vf fps=1 frame%04d.png                             # 1 fps
ffmpeg -y -ss 00:01:30 -i input.mp4 -frames:v 1 -q:v 2 thumb.jpg           # At timestamp
```

### Trim
Output seeking (frame-accurate, requires re-encode for clean cuts):
```bash
ffmpeg -y -i input.mp4 -ss 00:00:10 -to 00:00:30 output.mp4
```
Input seeking (fast, keyframe-aligned, may produce black frames with `-c copy`):
```bash
ffmpeg -y -ss 00:00:10 -to 00:00:30 -i input.mp4 -c copy output.mp4
```
See [recipes/gotchas.md](recipes/gotchas.md#input-vs-output-seeking) for the full tradeoff.

### Concat (file list, same codec/timebase)
```bash
# list.txt:
#   file 'a.mp4'
#   file 'b.mp4'
ffmpeg -y -f concat -safe 0 -i list.txt -c copy output.mp4
```
For mixed sources, see [recipes/intro-main-outro.md](recipes/intro-main-outro.md).

### Web-optimised default preset
Good baseline for VOD / archival / multi-device playback:
```bash
ffmpeg -y -i input.mp4 \
  -c:v libx264 -crf 18 -preset veryslow -tune fastdecode \
  -pix_fmt yuv420p -movflags +faststart \
  -c:a aac -b:a 192k \
  output.mp4
```

### YouTube upload
```bash
ffmpeg -y -i input.mp4 \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \
  -c:a aac -b:a 192k -movflags +faststart \
  youtube.mp4
```

### GIF (two-pass with palette for quality)
```bash
ffmpeg -y -i input.mp4 -vf "fps=10,scale=480:-1:flags=lanczos,palettegen" palette.png
ffmpeg -y -i input.mp4 -i palette.png \
  -lavfi "fps=10,scale=480:-1:flags=lanczos[x];[x][1:v]paletteuse" output.gif
```

### Streaming
```bash
# HLS
ffmpeg -y -i input.mp4 -codec: copy -start_number 0 -hls_time 10 -hls_list_size 0 -f hls playlist.m3u8

# RTMP live
ffmpeg -re -i input.mp4 -c:v libx264 -preset veryfast -maxrate 3000k -bufsize 6000k \
  -pix_fmt yuv420p -g 50 -c:a aac -b:a 160k -ac 2 -f flv rtmp://server/live/streamkey
```

### Hardware acceleration (CUDA quick form)
```bash
ffmpeg -y -hwaccel cuda -hwaccel_output_format cuda -i input.mp4 \
  -c:v h264_nvenc -preset p4 output.mp4
```
For full GPU matrix (NVENC, QSV, VAAPI) and tradeoffs, see [recipes/gpu-encoding.md](recipes/gpu-encoding.md).

### Batch
```bash
for f in *.mkv; do ffmpeg -y -i "$f" -c copy "${f%.mkv}.mp4"; done
for f in *.mp4; do ffmpeg -y -ss 00:00:05 -i "$f" -frames:v 1 "${f%.mp4}.jpg"; done
```

## Common Codecs

### Video
- **H.264** (`libx264`) -- universal compatibility, default for MP4
- **H.265** (`libx265`) -- ~30-50% smaller than H.264; add `-tag:v hvc1` for Apple/iOS playback
- **VP9** (`libvpx-vp9`) -- WebM, 20-50% smaller than H.264 at same quality, slower encode
- **AV1** (`libaom-av1`) -- best compression, slowest encode; `libsvtav1` is the fast alternative

### Audio
- **AAC** (`aac`) -- universal, default for MP4
- **MP3** (`libmp3lame`) -- legacy compatibility
- **Opus** (`libopus`) -- best quality/bitrate; default for WebM
- **FLAC** (`flac`) -- lossless

## Performance Tips

1. Use `-c copy` whenever possible (no re-encode) -- but see [recipes/gotchas.md](recipes/gotchas.md#when-c-copy-breaks)
2. Hardware acceleration for batch jobs -- see [recipes/gpu-encoding.md](recipes/gpu-encoding.md)
3. Presets: `ultrafast`/`superfast`/`veryfast`/`faster`/`fast`/`medium`/`slow`/`slower`/`veryslow` -- slower = better compression at same quality
4. `-threads 0` lets FFmpeg pick (default); only override for specific reasons
5. `-progress pipe:1` for parseable progress output in pipelines
6. Single `-filter_complex` with `split` produces multiple outputs in one decode pass -- always cheaper than running ffmpeg twice

## Troubleshooting

```bash
# Repair attempt
ffmpeg -y -err_detect ignore_err -i corrupted.mp4 -c copy repaired.mp4

# Fix A/V sync (offset audio +500ms)
ffmpeg -y -i input.mp4 -itsoffset 0.5 -i input.mp4 -map 0:v -map 1:a -c copy output.mp4

# Force pixel format compatibility (QuickTime, iOS, older players)
ffmpeg -y -i input.mp4 -c:v libx264 -pix_fmt yuv420p -c:a copy output.mp4
```

## Notes

- FFmpeg 8.0 with full codec support
- CUDA acceleration available
- Recipes assume sample inputs are reachable via URL (FFmpeg downloads them); replace with local paths in production
- Always `-y` for non-interactive automation

## Related Skills

- **imagemagick** -- still images
- **comfyui** -- AI-generated media
- **blender** -- 3D scenes
- **jupyter-notebooks** -- analyse media with Python
- **playwright** -- verify playback in a browser
