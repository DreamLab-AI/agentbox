# Blender Configuration

## Why this exists

Blender is a 3D modelling, animation and rendering suite. Agentbox bundles a headless Blender together with an MCP server (`/opt/agentbox/skills/blender/addon/server.py`) so agents can create scenes, import meshes, drive modifiers and render frames through structured tool calls rather than GUI clicks. The MCP server starts automatically under supervisord when the skill is enabled.

**What it solves**

- Agents that need to produce 3D assets, diagrams or rendered stills without a human at the keyboard.
- One pinned Blender version shared by every agent in the image.
- An MCP transport that survives container restarts (supervisord manages the process).

**When to skip this**: leave `blender = false` unless you have an agent workflow that actually drives Blender — the package is large and does nothing passively.

## Version

Agentbox uses `pkgs.blender` from nixpkgs-unstable. The current pinned nixpkgs provides Blender 4.x; Blender 5.0.1+ can be added via a nixpkgs input override in `flake.nix` if needed.

**Current assumption**: `pkgs.blender` ≥ 4.1 is acceptable. If Blender 5.0.1+ is required:

1. Add a nixpkgs overlay in `flake.nix` that fetches a newer revision, OR
2. Override the input in `flake.nix`:
   ```nix
   inputs.nixpkgs.url = "github:NixOS/nixpkgs/..."; # Pinned rev with Blender 5.0.1
   ```

## Enabling Blender

Set in `agentbox.toml`:
```toml
[skills.spatial_and_3d]
blender = true
```

Blender MCP server runs automatically as `blender-mcp` under supervisord (priority 231).

## Blender MCP Server

Located at `/opt/agentbox/skills/blender/addon/server.py`.
- Listens for MCP calls from agent orchestrators
- Requires `HOME=/home/devuser` for user config

## Custom Packages

To add Blender add-ons or dependencies:
1. Extend `spatialPackages` in `flake.nix` with additional `blenderPackages.*`
2. Or pin them in the MCP server's Python environment
