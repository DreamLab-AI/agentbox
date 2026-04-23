---
name: unreal-engine
description: >
  Unreal Engine 5 automation via 60+ MCP tools. Spawn actors, edit Blueprints, inspect
  materials, run PIE sessions, capture screenshots, profile performance, manage StateTrees,
  widgets, and assets. Works with running UE5 editor or packaged builds. Use when the user
  says "unreal engine", "UE5", "spawn actor", "blueprint", "PIE session", "unreal project".
  Complements game-dev skill which covers Godot/Unity/Unreal at design level; this skill
  provides direct UE5 editor control.
version: 1.0.0
author: softdaddy-o
mcp_server: true
protocol: stdio
entry_point: soft-ue-cli mcp-serve
tags:
  - unreal-engine
  - ue5
  - game-dev
  - blueprints
  - mcp
  - actors
env_vars:
  - SOFT_UE_BRIDGE
  - SOFT_UE_HOST
  - SOFT_UE_PORT
---

# Unreal Engine 5 — AI-Native Automation

Control Unreal Engine 5 from Claude via 60+ MCP tools or CLI. Spawn actors, edit Blueprints, inspect materials, run Play-In-Editor sessions, capture screenshots, profile performance, and more — all inside a running UE5 editor or packaged build.

## When to Use This Skill

- **UE5 editor control**: Spawn/move/delete actors, edit properties, manage levels
- **Blueprint automation**: Create, edit, compile Blueprints; Blueprint-to-C++ conversion
- **Material inspection**: Read material parameters, texture references, shader properties
- **PIE sessions**: Start/stop Play-In-Editor, capture gameplay screenshots
- **Performance profiling**: Frame time, draw calls, GPU/CPU stats
- **Asset management**: Browse, import, export, validate assets
- **StateTrees/Widgets**: Edit AI state trees, UMG widgets programmatically
- **CI/CD**: Automated builds, cook, package via CLI

## When Not to Use

- For game design at concept level (story, mechanics, GDD) — use `game-dev` (48 agents)
- For Godot or Unity — use `game-dev` which covers all three engines at design level
- For 3D modelling/rendering — use `blender`
- For AI-generated game art — use `comfyui` or `art`

## Setup

```bash
# Install
pip install "soft-ue-cli[mcp]"

# Install UE plugin into your project
soft-ue-cli setup /path/to/YourProject

# MCP server mode (for Claude)
soft-ue-cli mcp-serve

# CLI mode (for scripts/CI)
soft-ue-cli spawn-actor --class StaticMeshActor --location 100,200,50
```

## MCP Tools (60+)

### Actors
`spawn-actor`, `delete-actor`, `move-actor`, `get-actor`, `list-actors`, `set-property`, `get-property`

### Blueprints
`create-blueprint`, `edit-blueprint`, `compile-blueprint`, `add-node`, `connect-pins`, `blueprint-to-cpp`

### Materials
`get-material`, `list-materials`, `inspect-material`, `set-material-param`

### PIE (Play-In-Editor)
`pie-start`, `pie-stop`, `pie-screenshot`, `pie-status`

### Assets
`list-assets`, `import-asset`, `export-asset`, `validate-assets`

### Profiling
`profile-start`, `profile-stop`, `frame-stats`, `draw-call-stats`

### StateTrees & Widgets
`edit-statetree`, `list-widgets`, `modify-widget`

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SOFT_UE_BRIDGE` | | Set to enable conditional compilation of the bridge plugin |
| `SOFT_UE_HOST` | `127.0.0.1` | UE5 editor HTTP bridge host |
| `SOFT_UE_PORT` | `8080` | UE5 editor HTTP bridge port |

## Architecture

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ Claude Code  │────>│  soft-ue-cli     │────>│  UE5 Editor      │
│ (MCP client) │     │  MCP Server      │     │  HTTP Bridge     │
│              │     │  or CLI          │     │  Plugin          │
│              │     │  (Python/httpx)  │     │  (C++ conditional│
│              │     │                  │     │   compilation)   │
└──────────────┘     └──────────────────┘     └──────────────────┘
```

## Integration with Other Skills

| Skill | Relationship |
|-------|-------------|
| `game-dev` | Design-level game dev (GDD, mechanics, art direction); unreal-engine for direct editor control |
| `blender` | Create 3D assets in Blender, import into UE5 via unreal-engine asset tools |
| `clipcannon` | Capture UE5 gameplay footage, edit with ClipCannon for trailers/reels |
| `art` | Generate textures/UI art via Nano Banana 2, import into UE5 |
| `comfyui` | AI-generate textures/sprites via Stable Diffusion for UE5 materials |

## Attribution

soft-ue-cli by softdaddy-o. MIT License.
