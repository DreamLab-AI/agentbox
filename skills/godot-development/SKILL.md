---
name: godot-development
description: "Single-agent Godot 4 development: GDScript, C# scripting, scene editing, node systems, signals, physics, navigation, shaders, export builds. Use for targeted Godot scripting tasks without the full 48-agent game-dev studio. Also covers godot-rust (gdext) for native extensions and OpenXR/WebXR integration."
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

## Environment

- **Godot 4**: installed at `/usr/bin/godot4` or via PATH as `godot4`
- **godot-rust (gdext)**: crates at `crates/visionclaw-xr-gdext/` in VisionClaw project
- **Export templates**: headless export via `godot4 --export-release`

## Core Capabilities

### GDScript Patterns

```gdscript
# Signal declaration and connection
signal health_changed(new_health: int)

func _ready() -> void:
    health_changed.connect(_on_health_changed)

func take_damage(amount: int) -> void:
    health -= amount
    health_changed.emit(health)
```

### Scene manipulation
```bash
# Headless scene validation
godot4 --headless --script res://scripts/validate_scene.gd
```

### gdext (godot-rust) pattern
```rust
use godot::prelude::*;

#[derive(GodotClass)]
#[class(base=Node3D)]
struct MyNode {
    base: Base<Node3D>,
}

#[godot_api]
impl INode3D for MyNode {
    fn ready(&mut self) {
        godot_print!("MyNode ready");
    }
}
```

### Export builds
```bash
# Android APK (requires Android SDK configured)
godot4 --headless --export-release "Android" build/game.apk

# Web (HTML5)
godot4 --headless --export-release "Web" build/index.html
```

## OpenXR / WebXR Integration

For Meta Quest or OpenXR development in Godot, this skill works alongside `meta-xr-sdk`:
- Godot's XRServer and OpenXRInterface
- XRCamera3D, XRController3D, XROrigin3D node setup
- Hand tracking via OpenXR hand tracking extension
- Passthrough configuration

## Related skills

- `game-dev` — Full 48-agent game production studio (design/art/audio/QA)
- `meta-xr-sdk` — Meta-specific XR SDK, WebXR, hzdb MCP tools
- `rust-development` — For gdext / godot-rust extension development
- `blender` — 3D asset creation for import into Godot
