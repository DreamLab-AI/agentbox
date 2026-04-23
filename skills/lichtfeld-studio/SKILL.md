---
name: LichtFeld Studio
description: Control LichtFeld Studio for 3D Gaussian Splatting training, visualization, editing, and export via its built-in MCP server (70+ tools). Includes SplatReady plugin for video-to-COLMAP dataset conversion via COLMAP. Supports headless and GUI modes with real-time scene manipulation, camera control, gaussian editing, and automated training workflows.
---

# LichtFeld Studio Skill

Control LichtFeld Studio — a native C++23/CUDA workstation for 3D Gaussian Splatting — via its built-in MCP HTTP server on port 45677.

## When to Use

- Training 3D Gaussian Splat models from COLMAP datasets
- Rendering views from trained gaussian scenes
- Editing gaussian scenes (selection, deletion, transformation)
- Exporting models (PLY, SOG, SPZ, USD, HTML)
- Converting between gaussian formats
- Batch multi-view rendering
- Automated quality assessment of trained models
- LLM-guided scene cleanup (floater removal)

## When Not To Use

- For general 3D modeling (meshes, curves) — use the blender skill
- For AI image generation from text — use the comfyui skill
- For 2D image processing — use the imagemagick skill
- For geospatial 3D — use the qgis skill

## Architecture

LichtFeld Studio has a built-in MCP server speaking JSON-RPC 2.0 over HTTP POST at `http://127.0.0.1:45677/mcp`. A stdio-to-HTTP bridge script auto-launches the application.

```
Claude Code → stdio bridge → HTTP POST → LichtFeld MCP Server (port 45677)
```

### Key Paths

| Path | Purpose |
|------|---------|
| `/home/devuser/workspace/gaussians/LichtFeld-Studio/build/LichtFeld-Studio` | Built binary |
| `/home/devuser/workspace/gaussians/LichtFeld-Studio/scripts/lichtfeld_mcp_bridge.py` | stdio-to-HTTP MCP bridge |
| `http://127.0.0.1:45677/mcp` | HTTP MCP endpoint |

## Setup

### Option A: MCP Server Config (recommended)

Add to Claude settings to expose all 70+ tools as MCP tools:

```json
{
  "mcpServers": {
    "lichtfeld": {
      "command": "python3",
      "args": ["/home/devuser/workspace/gaussians/LichtFeld-Studio/scripts/lichtfeld_mcp_bridge.py"],
      "env": {
        "LICHTFELD_EXECUTABLE": "/home/devuser/workspace/gaussians/LichtFeld-Studio/build/LichtFeld-Studio"
      }
    }
  }
}
```

### Option B: Direct HTTP (when app is already running)

```bash
# Send a JSON-RPC 2.0 request directly
curl -s -X POST http://127.0.0.1:45677/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### Option C: Headless Mode (no display needed)

```bash
# Start headless with MCP server
LichtFeld-Studio --headless --data-path /path/to/colmap --output-path /path/to/output
```

### Option D: Format Conversion (no GPU needed for some formats)

```bash
LichtFeld-Studio convert input.ply output.spz
LichtFeld-Studio convert input.ply output.html
```

## Instructions

### Direct HTTP Tool Invocation

All LichtFeld MCP tools can be called via HTTP POST. The pattern is:

```bash
curl -s -X POST http://127.0.0.1:45677/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "TOOL_NAME",
      "arguments": { ... }
    }
  }' | jq
```

### Listing Available Tools

```bash
curl -s -X POST http://127.0.0.1:45677/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools[].name'
```

### Listing Available Resources

```bash
curl -s -X POST http://127.0.0.1:45677/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"resources/list"}' | jq '.result.resources[].uri'
```

### Reading a Resource

```bash
curl -s -X POST http://127.0.0.1:45677/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"resources/read","params":{"uri":"lichtfeld://training/state"}}' | jq
```

## Tool Categories (70+ built-in tools)

### Training Control
| Tool | Parameters | Description |
|------|-----------|-------------|
| `scene.load_dataset` | `path`, `images_folder`, `max_iterations`, `strategy` | Load COLMAP dataset |
| `scene.load_checkpoint` | `path` | Resume from .resume file |
| `scene.save_checkpoint` | `path` | Save training state |
| `training.start` | — | Begin/resume training |
| `training.get_state` | — | Get iteration, loss, num_gaussians, is_running |
| `training.get_loss_history` | — | Loss curve data points |
| `training.list_operations` | — | List CommandCenter operations |
| `training.ask_advisor` | `question` | LLM-based training advice with render |

### Camera Control (GUI mode)
| Tool | Parameters | Description |
|------|-----------|-------------|
| `camera.get` | — | Current camera position/rotation/FOV |
| `camera.set_view` | `position`, `target`, `up`, `fov` | Set camera transform |
| `camera.reset` | — | Reset to default view |
| `camera.list` | — | List dataset cameras |
| `camera.go_to_dataset_camera` | `index` | Jump to dataset camera |

### Rendering
| Tool | Parameters | Description |
|------|-----------|-------------|
| `render.capture` | `camera_index`, `width`, `height` | Render to base64 PNG |
| `render.settings.get` | — | Current render settings |
| `render.settings.set` | various | Modify render settings |

### Gaussian Selection
| Tool | Parameters | Description |
|------|-----------|-------------|
| `selection.rect` | `x`, `y`, `width`, `height` | Select in screen rectangle |
| `selection.polygon` | `points` | Select inside polygon |
| `selection.lasso` | `points` | Freeform lasso selection |
| `selection.ring` | `x`, `y` | Pick front-most gaussian |
| `selection.brush` | `x`, `y`, `radius` | Brush/radius select |
| `selection.click` | `x`, `y` | Click select |
| `selection.get` | — | Return selected indices |
| `selection.clear` | — | Clear selection |
| `selection.by_description` | `description` | LLM vision-based NL selection |

### Scene Graph (GUI mode)
| Tool | Parameters | Description |
|------|-----------|-------------|
| `scene.list_nodes` | — | List all scene nodes |
| `scene.get_selected_nodes` | — | Currently selected nodes |
| `scene.select_node` | `name` | Select a node |
| `scene.set_node_visibility` | `name`, `visible` | Toggle visibility |
| `scene.set_node_locked` | `name`, `locked` | Toggle lock |
| `scene.rename_node` | `name`, `new_name` | Rename node |
| `scene.reparent_node` | `name`, `parent` | Move in hierarchy |
| `scene.add_group` | `name` | Create group node |
| `scene.duplicate_node` | `name` | Duplicate a node |
| `scene.merge_group` | `name` | Merge group children |

### Export
| Tool | Parameters | Description |
|------|-----------|-------------|
| `scene.save_ply` | `path` | Export as PLY |
| `scene.export_ply` | `path` | Export as PLY (async) |
| `scene.export_sog` | `path` | Export as SOG |
| `scene.export_spz` | `path` | Export as SPZ (compressed) |
| `scene.export_usd` | `path` | Export as Universal Scene Description |
| `scene.export_html` | `path` | Export as self-contained HTML viewer |
| `scene.export_status` | — | Check async export progress |
| `scene.export_cancel` | — | Cancel running export |

### History/Undo (GUI mode)
| Tool | Parameters | Description |
|------|-----------|-------------|
| `history.get` | — | Current history state |
| `history.list` | — | Full undo stack |
| `history.undo` | — | Undo last action |
| `history.redo` | — | Redo |
| `history.begin_transaction` | `name` | Start grouped operation |
| `history.commit_transaction` | — | Commit group |
| `history.rollback_transaction` | — | Rollback group |

### Crop Box & Ellipsoid
| Tool | Parameters | Description |
|------|-----------|-------------|
| `crop_box.add` | — | Add crop box |
| `crop_box.get` | — | Get crop box params |
| `crop_box.set` | `center`, `size`, `rotation` | Set crop box |
| `crop_box.fit` | — | Fit to scene |
| `ellipsoid.add` | — | Add ellipsoid selector |
| `ellipsoid.set` | `center`, `radii`, `rotation` | Set ellipsoid |

### Python Editor (GUI mode)
| Tool | Parameters | Description |
|------|-----------|-------------|
| `editor.set_code` | `code` | Set Python code |
| `editor.run` | — | Execute code |
| `editor.get_output` | — | Read stdout/stderr |
| `editor.wait` | — | Wait for completion |
| `editor.interrupt` | — | Kill running script |

### Events (pub/sub)
| Tool | Parameters | Description |
|------|-----------|-------------|
| `events.subscribe` | `event_type` | Subscribe to events |
| `events.poll` | `subscription_id` | Poll for events |
| `events.unsubscribe` | `subscription_id` | Unsubscribe |
| `events.list` | — | List event types |

### Low-Level Gaussian Access
| Tool | Parameters | Description |
|------|-----------|-------------|
| `gaussians.read` | `indices`, `attributes` | Read GPU tensor data |
| `gaussians.write` | `indices`, `attributes`, `values` | Write GPU tensor data |

### Plugins
| Tool | Parameters | Description |
|------|-----------|-------------|
| `plugin.list` | — | List registered plugins |
| `plugin.invoke` | `name`, `capability`, `params` | Invoke plugin capability |

## MCP Resources (read-only)

| URI | Description |
|-----|-------------|
| `lichtfeld://training/state` | Training iteration, loss, gaussians count |
| `lichtfeld://training/loss_curve` | Loss history data points |
| `lichtfeld://render/current` | Current viewport as base64 PNG |
| `lichtfeld://scene/nodes` | Scene graph structure |
| `lichtfeld://selection/mask` | Current selection mask |
| `lichtfeld://history/state` | Undo/redo state |
| `lichtfeld://editor/code` | Python editor content |
| `lichtfeld://editor/output` | Script output |

## Workflow Examples

### Train a Model from COLMAP Dataset

```bash
# 1. Launch headless
LichtFeld-Studio --headless --data-path ./my_dataset --output-path ./output &

# 2. Wait for MCP server, then monitor
curl -s -X POST http://127.0.0.1:45677/mcp \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"training.get_state","arguments":{}}}' | jq

# 3. Capture a render at a dataset camera
curl -s -X POST http://127.0.0.1:45677/mcp \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"render.capture","arguments":{"camera_index":0,"width":1920,"height":1080}}}' | jq
```

### Export to Multiple Formats

```bash
# Export pipeline
for fmt in ply spz html; do
  curl -s -X POST http://127.0.0.1:45677/mcp \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"scene.export_${fmt}\",\"arguments\":{\"path\":\"./output/model.${fmt}\"}}}"
done
```

### LLM-Guided Scene Cleanup

```bash
# Select floaters using natural language
curl -s -X POST http://127.0.0.1:45677/mcp \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"selection.by_description","arguments":{"description":"floating artifacts and noise outside the main object"}}}'

# Delete selected gaussians
curl -s -X POST http://127.0.0.1:45677/mcp \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"gaussians.write","arguments":{"delete_selected":true}}}'
```

### Batch Multi-View Render

```bash
# List cameras, then render each
CAMERAS=$(curl -s -X POST http://127.0.0.1:45677/mcp \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"camera.list","arguments":{}}}' | jq -r '.result.content[0].text | fromjson | length')

for i in $(seq 0 $((CAMERAS-1))); do
  curl -s -X POST http://127.0.0.1:45677/mcp \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"render.capture\",\"arguments\":{\"camera_index\":$i,\"width\":1920,\"height\":1080}}}" \
    | jq -r '.result.content[0].text' | base64 -d > "render_${i}.png"
done
```

## CLI Reference

```bash
# GUI mode (default)
LichtFeld-Studio

# Headless training
LichtFeld-Studio --headless --data-path ./data --output-path ./out

# Resume from checkpoint
LichtFeld-Studio --headless --resume checkpoint.resume

# With strategy
LichtFeld-Studio --headless -d ./data -o ./out --strategy mcmc --eval

# Format conversion
LichtFeld-Studio convert input.ply output.spz
LichtFeld-Studio convert input.ply output.html

# Plugin management
LichtFeld-Studio plugin list
LichtFeld-Studio plugin create my_plugin
LichtFeld-Studio plugin check my_plugin

# PTX warmup (build verification)
LichtFeld-Studio --warmup

# With Python training callbacks
LichtFeld-Studio --headless -d ./data -o ./out --python-script callbacks.py
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LICHTFELD_MCP_ENDPOINT` | `http://127.0.0.1:45677/mcp` | MCP HTTP endpoint |
| `LICHTFELD_EXECUTABLE` | auto-detect in build/ | Path to binary |
| `LICHTFELD_MCP_START_TIMEOUT_S` | `90` | Startup timeout for bridge |
| `LICHTFELD_MCP_BRIDGE_LOG` | `~/.codex/log/lichtfeld-mcp-bridge.log` | Bridge log file |

## SplatReady Plugin (Video to COLMAP)

SplatReady is installed at `~/.lichtfeld/plugins/splat_ready/` and converts video files into COLMAP datasets for gaussian splat training.

### Pipeline Stages

1. **Frame Extraction** — FFmpeg/PyAV extracts frames at configurable FPS, with optional GPS EXIF from DJI SRT files
2. **COLMAP Reconstruction** — Feature extraction, matching, sparse reconstruction, alignment, undistortion
3. **Import** — Load the undistorted COLMAP dataset directly into LichtFeld Studio

### CLI Usage (headless, no GUI needed)

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

### Frame Extraction Only

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

### COLMAP Reconstruction Only (from existing frames)

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

### Output Structure

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

### Dependencies

| Dependency | Status | Path |
|-----------|--------|------|
| COLMAP | 4.1.0 (CUDA) | `/usr/local/bin/colmap` |
| FFmpeg | installed | `/usr/bin/ffmpeg` |
| PyAV | 17.0.0 | Python package |
| Pillow | installed | Python package |
| piexif | 1.1.3 | Python package |

## Troubleshooting

- **App won't start**: Run `LichtFeld-Studio --warmup` to verify CUDA/PTX compilation
- **MCP not responding**: Check `curl -s http://127.0.0.1:45677/mcp -d '{"jsonrpc":"2.0","id":0,"method":"ping"}'`
- **Headless no MCP**: The headless path currently does not start the MCP server (GUI-only). Use GUI mode or apply the headless MCP patch.
- **Bridge log**: Check `~/.codex/log/lichtfeld-mcp-bridge.log`
