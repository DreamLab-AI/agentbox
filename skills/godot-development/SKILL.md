---
name: godot-development
description: "Single-agent Godot 4 work: write/debug GDScript or C# scripts, edit scenes and node systems, wire signals, physics, navigation, shaders, export builds, godot-rust (gdext) native extensions, and OpenXR/WebXR integration. Use for targeted Godot scripting without the full game-dev studio. NOT for full multi-system game production with art/audio/QA teams (use game-dev), and NOT a bundled engine — Godot 4 itself is not installed in this container (see Environment)."
---

# Godot Development

Focused single-agent skill for Godot 4 scripting and scene work. For full game production with art, audio, design, and QA teams, use `game-dev` (48-agent studio) instead.

## When to use this vs game-dev

| Use `godot-development` (this skill) | Use `game-dev` |
|--------------------------------------|----------------|
| Writing or debugging a specific script | Full game project with multiple systems |
| Adding a node type or signal connection | Needs art, audio, QA coordination |
| Single mechanic implementation | Multi-week production pipeline |
| gdext / godot-rust extension | Engine-agnostic game architecture |
| OpenXR / WebXR Godot integration | — |
| Export build configuration | — |

## Environment (read before running anything)

- **Godot 4 engine is NOT installed in this container** — there is no `godot4`
  on PATH nor at `/usr/bin/godot4`. Every `godot4 …` command in this skill must
  run **host-side** (or on CI), or the engine must be installed separately /
  gated into the image first. In-container work is limited to editing scripts,
  scenes, and the Rust extension.
- **godot-rust (gdext)**: crate `visionclaw-xr-gdext`, source at
  `xr-client/rust/` in the VisionClaw project — **not** under `crates/` (that
  holds the separate `visionclaw-xr-presence` crate). Builds with the
  in-container Rust toolchain.

## Core capabilities

Code patterns and export/OpenXR detail live in
[`references/patterns.md`](references/patterns.md):

- GDScript signals, `_ready`, damage/health example
- Headless scene validation
- gdext (`GodotClass` / `INode3D`) native-extension skeleton
- Export builds (Android APK, Web/HTML5) — host-side engine required
- OpenXR / WebXR: XRServer, `XRCamera3D` / `XRController3D` / `XROrigin3D`,
  hand tracking, passthrough

## Related skills

- `game-dev` — Full 48-agent game production studio (design/art/audio/QA)
- `meta-xr-sdk` — Meta-specific XR SDK, WebXR, hzdb MCP tools
- `rust-development` — For gdext / godot-rust extension development
- `blender` — 3D asset creation for import into Godot
