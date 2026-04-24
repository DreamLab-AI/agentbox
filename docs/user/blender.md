# Blender Configuration

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
- Requires `HOME=/workspace` for user config

## Custom Packages

To add Blender add-ons or dependencies:
1. Extend `spatialPackages` in `flake.nix` with additional `blenderPackages.*`
2. Or pin them in the MCP server's Python environment
