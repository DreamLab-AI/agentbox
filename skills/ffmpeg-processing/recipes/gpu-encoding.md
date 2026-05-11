# GPU Encoding Matrix

NVIDIA NVENC, Intel Quick Sync (QSV), AMD Mesa VAAPI. Trade quality for throughput.

## When to use GPU encoding

- **Yes**: batch transcoding, live streaming, real-time pipelines, CI thumbnail generation, anything where wall-clock matters more than the last few percent of compression efficiency.
- **No**: archival masters, single one-off encodes where you want the smallest file at a given quality. Software encoders (`libx264`, `libx265`, `libsvtav1`) still win on rate-distortion.

GPU encoders are typically **3-10× faster** than CPU but produce **20-40% larger files** at the same visual quality. The gap is closing each generation but hasn't closed.

## NVIDIA NVENC

Available on most GeForce GTX 600+ and all RTX cards. Requires CUDA runtime and matching driver.

### Encoders

| Encoder | Codec | Notes |
|---------|-------|-------|
| `h264_nvenc` | H.264 | Universal compatibility |
| `hevc_nvenc` | H.265 | Better compression, add `-tag:v hvc1` for Apple |
| `av1_nvenc` | AV1 | RTX 40-series and newer only |

### Basic transcode (decode on CPU, encode on GPU)

```bash
ffmpeg -y -i input.mp4 -c:v h264_nvenc -preset p5 -cq 23 -c:a copy output.mp4
```

### Full GPU pipeline (decode + filter + encode all on GPU)

```bash
ffmpeg -y -hwaccel cuda -hwaccel_output_format cuda \
  -i input.mp4 \
  -vf "scale_cuda=1920:1080" \
  -c:v h264_nvenc -preset p5 -cq 23 -c:a copy \
  output.mp4
```

`-hwaccel_output_format cuda` keeps frames in GPU memory between decode and encode -- avoids CPU↔GPU round-trips. Use `scale_cuda` instead of `scale` when frames live on the GPU.

### NVENC presets

`-preset p1` (fastest, worst quality) through `-preset p7` (slowest, best quality). `p4` is the balanced default; `p5`-`p6` are good for VOD; `p1`-`p2` for live.

Older preset names (`fast`, `medium`, `slow`, etc.) still work for backward compat but map to the `p1`-`p7` scale.

### Quality control

- `-cq 23` -- constant quality (similar feel to CRF), 0-51, lower is better
- `-b:v 5M` -- target bitrate (1-pass)
- `-rc vbr -b:v 5M -maxrate 8M -bufsize 10M` -- VBR with cap
- `-rc cbr -b:v 5M` -- constant bitrate (live streaming)

### NVENC tuning flags

```bash
-rc-lookahead 32      # Look-ahead frames (10-32 sweet spot)
-spatial_aq 1         # Spatial adaptive quantisation -- better quality in flat regions
-temporal_aq 1        # Temporal AQ
-b_ref_mode middle    # Use B-frames as references (improves compression)
```

## Intel Quick Sync (QSV)

Available on Intel CPUs with integrated graphics (HD/UHD/Iris/Arc). On Linux, requires `intel-media-driver` (Iris/Arc) or `libva-intel-driver` (older).

```bash
ffmpeg -y -init_hw_device qsv=hw -filter_hw_device hw \
  -i input.mp4 \
  -c:v h264_qsv -preset medium -global_quality 23 \
  -c:a copy output.mp4
```

### Encoders

| Encoder | Codec |
|---------|-------|
| `h264_qsv` | H.264 |
| `hevc_qsv` | H.265 |
| `av1_qsv` | AV1 (Arc and 11th gen+) |
| `vp9_qsv` | VP9 |

### Decode + encode on QSV

```bash
ffmpeg -y -hwaccel qsv -c:v h264_qsv -i input.mp4 \
  -c:v hevc_qsv -global_quality 23 -c:a copy output.mp4
```

`-c:v h264_qsv` before `-i` selects the QSV decoder; the same flag after `-i` selects the encoder. Keeps frames on the GPU.

### QSV quality modes

- `-global_quality 23` -- ICQ (intelligent constant quality), similar to CRF
- `-b:v 5M` -- target bitrate

## AMD VAAPI (Linux)

Slightly more setup-heavy than NVENC/QSV. Requires the Mesa VAAPI driver.

```bash
ffmpeg -y -vaapi_device /dev/dri/renderD128 \
  -i input.mp4 \
  -vf 'format=nv12,hwupload' \
  -c:v h264_vaapi -qp 23 -c:a copy output.mp4
```

`format=nv12,hwupload` is required to get frames into VAAPI memory. Use `scale_vaapi` for hardware scaling.

### Encoders

| Encoder | Codec |
|---------|-------|
| `h264_vaapi` | H.264 |
| `hevc_vaapi` | H.265 |
| `av1_vaapi` | AV1 (RDNA3+) |

## Live streaming preset (NVENC, low latency)

```bash
ffmpeg -re -i input.mp4 \
  -c:v h264_nvenc -preset p1 -tune ull -rc cbr -b:v 4M -maxrate 4M -bufsize 4M \
  -g 60 -bf 0 -profile:v high \
  -c:a aac -b:a 160k -ac 2 \
  -f flv rtmp://server/live/streamkey
```

`-tune ull` = ultra-low-latency. `-bf 0` = no B-frames (latency cost). `-g 60` = keyframe every 2 seconds at 30fps.

## Verifying GPU acceleration is actually being used

```bash
# List the GPU encoders your build supports
ffmpeg -encoders | grep -E '(nvenc|qsv|vaapi)'

# List the GPU decoders
ffmpeg -hwaccels

# Run with -loglevel verbose and watch for the encoder init messages
ffmpeg -loglevel verbose -i input.mp4 -c:v h264_nvenc out.mp4 2>&1 | grep -i nvenc
```

If `ffmpeg -encoders` doesn't list `*_nvenc`/`*_qsv`/`*_vaapi`, your build wasn't compiled with that backend -- this is the agentbox FFmpeg image, which bundles NVENC support; QSV/VAAPI may need additional runtime dependencies.

## Choosing between NVENC, QSV, VAAPI

| Factor | NVENC | QSV | VAAPI |
|--------|-------|-----|-------|
| Quality at same bitrate | Best (newer gens) | Good | Good |
| Throughput | Excellent | Excellent | Good |
| Linux setup | Easy (driver + CUDA) | Medium | Medium-hard |
| AV1 encode | RTX 40+ | Arc / 11th gen+ | RDNA3+ |
| HEVC `hvc1` tag for Apple | Add `-tag:v hvc1` | Add `-tag:v hvc1` | Add `-tag:v hvc1` |
| Best for | NVIDIA-equipped servers | Intel-only or hybrid | AMD-only |

In the agentbox CUDA-enabled image, NVENC is the default path -- see [../SKILL.md](../SKILL.md#hardware-acceleration-cuda-quick-form).
