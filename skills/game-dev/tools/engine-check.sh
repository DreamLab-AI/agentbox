#!/usr/bin/env bash
# Engine availability checker for game-dev skill
set -euo pipefail

echo "=== Game Development Engine Availability ==="
echo ""

# Godot
if command -v godot &>/dev/null; then
    echo "[INSTALLED] Godot $(godot --version 2>&1 | head -1)"
    echo "  Binary: $(which godot)"
    echo "  Headless: supported (godot --headless)"
    echo "  Display: ${DISPLAY:-not set}"
else
    echo "[NOT INSTALLED] Godot"
    echo "  Install: sudo pacman -S godot"
fi
echo ""

# Blender (asset pipeline)
if command -v blender &>/dev/null; then
    echo "[INSTALLED] Blender $(blender --version 2>&1 | head -1)"
    echo "  Binary: $(which blender)"
    echo "  Use: Asset pipeline, 3D modelling, rendering"
else
    echo "[NOT INSTALLED] Blender"
    echo "  Install: sudo pacman -S blender"
fi
echo ""

# Unity
echo "[EXTERNAL MCP REQUIRED] Unity"
echo "  Unity cannot be installed in this container."
echo "  To use Unity agents, connect an external MCP server:"
echo "  1. Install Unity Hub on your development machine"
echo "  2. Run the Unity MCP bridge: npx @anthropic/mcp-unity"
echo "  3. Add the MCP server to your Claude Code config"
echo "  See: engine-reference/unity/VERSION.md for supported versions"
echo ""

# Unreal Engine
echo "[EXTERNAL MCP REQUIRED] Unreal Engine 5"
echo "  Unreal Engine cannot be installed in this container."
echo "  To use Unreal agents, connect an external MCP server:"
echo "  1. Install UE5 via Epic Games Launcher"
echo "  2. Run the Unreal MCP bridge: npx @anthropic/mcp-unreal"
echo "  3. Add the MCP server to your Claude Code config"
echo "  See: engine-reference/unreal/VERSION.md for supported versions"
echo ""

# Supporting tools
echo "=== Supporting Tools ==="
if command -v ffmpeg &>/dev/null; then
    echo "[INSTALLED] FFmpeg (audio/video processing)"
fi
if command -v convert &>/dev/null; then
    echo "[INSTALLED] ImageMagick (image processing)"
fi
if command -v mmdc &>/dev/null; then
    echo "[INSTALLED] Mermaid CLI (diagram generation)"
fi
if command -v playwright &>/dev/null || command -v npx &>/dev/null; then
    echo "[INSTALLED] Playwright (UI testing/screenshots)"
fi
echo ""
echo "=== VNC Display ==="
if [[ -f /tmp/.X1-lock ]]; then
    echo "[RUNNING] VNC Display :1 available for GUI operations"
else
    echo "[NOT RUNNING] No VNC display detected"
fi
