# SplatReady Plugin — Video to COLMAP

SplatReady is installed at `~/.lichtfeld/plugins/splat_ready/` and converts video
files into COLMAP datasets for gaussian splat training. The `tools/video2splat.sh`
wrapper runs the full pipeline (video → COLMAP → LichtFeld training) end to end;
the calls below are for running individual stages.

## Pipeline stages

1. **Frame Extraction** — FFmpeg/PyAV extracts frames at configurable FPS, with optional GPS EXIF from DJI SRT files
2. **COLMAP Reconstruction** — Feature extraction, matching, sparse reconstruction, alignment, undistortion
3. **Import** — Load the undistorted COLMAP dataset directly into LichtFeld Studio

## CLI usage (headless, no GUI needed)

```bash
# Create config
cat > /tmp/splatready_config.json << 'CONF'
{
  "video_path": "/path/to/video.mp4",
  "base_output_folder": "/path/to/output",
  "frame_rate": 1.0,
  "skip_extraction": false,
  "reconstruction_method": "colmap",
  "colmap_exe_path": "/usr/local/bin/colmap",
  "use_fisheye": false,
  "max_image_size": 2000,
  "min_scale": 0.5,
  "skip_reconstruction": false
}
CONF

# Run the pipeline
python3 ~/.lichtfeld/plugins/splat_ready/core/runner.py /tmp/splatready_config.json

# Then train in LichtFeld
lichtfeld-studio --headless --data-path /path/to/output/colmap/undistorted --output-path /path/to/output/model
```

## Frame extraction only

```bash
python3 -c "
from pathlib import Path
import sys
sys.path.insert(0, str(Path.home() / '.lichtfeld/plugins/splat_ready'))
from core.frame_extractor import extract_frames
result = extract_frames('/path/to/video.mp4', '/path/to/output', 1.0, print)
print(f'Frames at: {result}')
"
```

## COLMAP reconstruction only (from existing frames)

```bash
python3 -c "
from pathlib import Path
import sys
sys.path.insert(0, str(Path.home() / '.lichtfeld/plugins/splat_ready'))
from core.colmap_processor import process_colmap
result = process_colmap('/path/to/frames', '/path/to/output', '/usr/local/bin/colmap', {'max_image_size': 2000, 'min_scale': 0.5}, print)
print(f'Undistorted at: {result}')
"
```

## Output structure

```
output/
  frames/
    VideoName/           # JPEG frames with GPS EXIF
  colmap/
    undistorted/
      images/            # Processed images
      sparse/0/
        cameras.txt
        images.txt
        points3D.txt
```

## Dependencies

| Dependency | Status | Path |
|-----------|--------|------|
| COLMAP | 4.1.0 (CUDA) | `/usr/local/bin/colmap` |
| FFmpeg | installed | `/usr/bin/ffmpeg` |
| PyAV | 17.0.0 | Python package |
| Pillow | installed | Python package |
| piexif | 1.1.3 | Python package |
