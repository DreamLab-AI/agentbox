# Godot Development — Patterns & Reference

Depth for the `godot-development` skill. Load on demand.

## Environment (detail)

- **Godot 4 engine**: **not baked into this container** — there is no `godot4`
  binary on PATH or at `/usr/bin/godot4`. It runs **host-side**, or must be
  installed separately (e.g. distro package, official binary, or a Nix gate on
  the image) before any `godot4 …` command below will work. Treat every
  `godot4` invocation here as "run on a host/CI machine that has the engine",
  not inside agentbox as shipped.
- **godot-rust (gdext)**: the native-extension crate is
  `visionclaw-xr-gdext`, whose source lives at
  `xr-client/rust/` in the VisionClaw project
  (`/home/devuser/workspace/project/xr-client/rust/`, `Cargo.toml` name
  `visionclaw-xr-gdext`). It is **not** under `crates/` — the `crates/`
  directory holds the separate `visionclaw-xr-presence` crate. gdext builds
  with a normal Rust toolchain (present in-container); only the running
  Godot editor/runtime is host-side.
- **Export templates**: headless export via `godot4 --export-release` — again,
  wherever the engine + templates are installed, not in the bare container.

## GDScript Patterns

```gdscript
# Signal declaration and connection
signal health_changed(new_health: int)

func _ready() -> void:
    health_changed.connect(_on_health_changed)

func take_damage(amount: int) -> void:
    health -= amount
    health_changed.emit(health)
```

## Scene manipulation

```bash
# Headless scene validation (needs a host-side Godot 4 engine)
godot4 --headless --script res://scripts/validate_scene.gd
```

## gdext (godot-rust) pattern

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

## Export builds

```bash
# Android APK (requires Android SDK + a host-side Godot 4 engine)
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
