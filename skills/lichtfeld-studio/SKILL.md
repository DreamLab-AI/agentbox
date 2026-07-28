---
name: lichtfeld-studio
description: "Drive LichtFeld Studio (native C++/CUDA 3D Gaussian Splatting workstation) via its built-in MCP server. Use when training, rendering, editing, or exporting 3D Gaussian Splats, or converting video into a COLMAP dataset for splat training."
---

# LichtFeld Studio Skill

Control LichtFeld Studio — a native C++23/CUDA workstation for 3D Gaussian
Splatting — via its built-in MCP HTTP server on port 45677.

## When to Use

- Training 3D Gaussian Splat models from COLMAP datasets
- Rendering / batch multi-view rendering from trained gaussian scenes
- Editing gaussian scenes (selection, deletion, transformation)
- Exporting models (PLY, SOG, SPZ, USD, HTML) or converting between formats
- Automated quality assessment or LLM-guided scene cleanup (floater removal)
- Converting a video into a COLMAP dataset (SplatReady) for training

## When Not To Use

- General 3D modeling (meshes, curves) — use the **blender** skill
- AI image generation from text — use the **comfyui** skill
- 2D image processing — use the **imagemagick** skill
- Geospatial 3D — use the **qgis** skill

## Architecture

LichtFeld Studio has a built-in MCP server speaking JSON-RPC 2.0 over HTTP POST at
`http://127.0.0.1:45677/mcp`. A stdio-to-HTTP bridge script auto-launches the app.

```
Claude Code → stdio bridge → HTTP POST → LichtFeld MCP Server (port 45677)
```

| Path | Purpose |
|------|---------|
| `/home/devuser/workspace/gaussians/LichtFeld-Studio/build/LichtFeld-Studio` | Built binary |
| `/home/devuser/workspace/gaussians/LichtFeld-Studio/scripts/lichtfeld_mcp_bridge.py` | stdio-to-HTTP MCP bridge |
| `http://127.0.0.1:45677/mcp` | HTTP MCP endpoint |

## Quick Path

Two runnable helpers ship with this skill — prefer them over hand-rolling curl:

```bash
# MCP control — ping / discover / call tools / read resources
tools/lfs-mcp.sh ping
tools/lfs-mcp.sh list                      # live tool discovery (70+ tools)
tools/lfs-mcp.sh call training.get_state
tools/lfs-mcp.sh call render.capture '{"width":1920,"height":1080}'
tools/lfs-mcp.sh read lichtfeld://training/state

# End-to-end: video → COLMAP → trained splat
tools/video2splat.sh input.mp4 ./out [fps] [max_iter] [strategy]
```

### Setup — MCP server config (recommended)

Add to Claude settings to expose all built-in tools as MCP tools:

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

Alternatives: talk to a running app directly over HTTP, run `--headless` (no
display), or `LichtFeld-Studio convert in.ply out.spz` for GPU-free format
conversion. Full forms in `references/workflows.md`.

## References

- **`references/tool-catalog.md`** — the 70+ MCP tools by category (training,
  camera, render, selection, scene graph, export, history, crop/ellipsoid, python
  editor, events, low-level gaussians, plugins) + read-only resource URIs.
- **`references/workflows.md`** — raw JSON-RPC HTTP forms, worked workflow examples
  (train, multi-format export, LLM cleanup, batch render), full CLI reference, and
  environment variables.
- **`references/splatready.md`** — the SplatReady video→COLMAP plugin: pipeline
  stages, per-stage CLI, output layout, and dependencies.

## Troubleshooting

- **App won't start**: run `LichtFeld-Studio --warmup` to verify CUDA/PTX compilation.
- **MCP not responding**: `tools/lfs-mcp.sh ping` (or `curl -s http://127.0.0.1:45677/mcp -d '{"jsonrpc":"2.0","id":0,"method":"ping"}'`).
- **Headless no MCP**: the headless path currently does not start the MCP server (GUI-only). Use GUI mode or apply the headless MCP patch.
- **Bridge log**: check `~/.codex/log/lichtfeld-mcp-bridge.log`.
