# XR Runtime Sidecar (Monado OpenXR desktop runtime + Godot 4.3)

A standalone, GPU-backed OpenXR debug/test environment for the native Quest XR
client — **no physical headset required**. It runs the open-source [Monado]
OpenXR runtime with a simulated 6DoF HMD, builds the `visionclaw-xr-gdext`
GDExtension for desktop Linux, and launches the Godot 4.3 project against it so
you can watch the stereo render and exercise the OpenXR session lifecycle over
VNC.

It mirrors the `browsercontainer/` pattern: a separate compose file on the
external `visionclaw_network`, managed through `agentbox.sh xr-runtime …`. It is
**not** a Nix-managed service.

[Monado]: https://monado.dev

## Why this exists

The Godot client's boot script (`xr_boot.gd`) hard-fails without an OpenXR
runtime — there is no flat-screen fallback. On a workstation with no headset
there was previously no way to bring up an OpenXR session, validate the binary
protocol decode / presence WS, or see the scene mount. Monado provides a
software OpenXR runtime that satisfies `XRServer.find_interface("OpenXR")` and
runs a real (simulated) session, closing that gap.

## What it validates — and what it does NOT

Monado implements **core OpenXR** only. Use it to validate:

- OpenXR session lifecycle (create → begin → sync → end)
- stereo view configuration + compositor submit
- the GDExtension cdylib loading and running on desktop
- scene mount (`XRBoot → GraphScene`) and HUD
- binary position-protocol decode + presence WebSocket against the backend
- simulated controller / headset input (qwerty driver)

It will **NOT** exercise Quest vendor extensions. Passthrough, hand-tracking,
foveation, and spatial anchors come from the `godot_openxr_vendors` addon, which
is **Android/Quest-only** and does not load on desktop Monado. Those paths
remain device-only and must be tested on a real Quest. `xr_boot.gd` already
degrades gracefully (it pushes warnings and proceeds when passthrough /
hand-tracking are unavailable), so the scene still mounts here.

## Ports

| Host port | Container port | Service |
|-----------|----------------|---------|
| 5904 | 5904 | VNC — Monado compositor window + Godot stereo render |

There is no inbound app port. The gdext presence WS / binary protocol dials
**out** to the backend (`XR_BACKEND_WS`, default `ws://visionclaw_container:4000`)
across `visionclaw_network`.

## Usage

```bash
agentbox.sh xr-runtime up        # build + start (waits for Docker health)
agentbox.sh xr-runtime vnc       # print the VNC address to connect
agentbox.sh xr-runtime logs      # follow logs (watch gdext build + OpenXR init)
agentbox.sh xr-runtime health    # show Docker health status
agentbox.sh xr-runtime status    # compose ps
agentbox.sh xr-runtime gpu       # nvidia-smi + vulkaninfo inside the container
agentbox.sh xr-runtime shell     # bash in the container as devuser
agentbox.sh xr-runtime rebuild   # down + build --no-cache + up
agentbox.sh xr-runtime down      # stop
```

Then connect a VNC viewer to `vnc://<host>:5904` to watch the Monado compositor
window and the Godot stereo render. The default `simulated` HMD is a **static**
stereo head — enough to validate session bring-up, stereo submit, and scene
mount. For an interactive 6DoF head (WASD translate, click-drag look) set
`XR_INPUT_DRIVER=qwerty`, but note it is experimental (see Known risks).

### First boot is slow

On the first `up`, the container compiles `visionclaw-xr-gdext` (the godot-rust
bindings + tokio + nalgebra) — roughly **5–10 minutes cold**. The compose
healthcheck has a 600s `start_period` to cover this. The cdylib and the cargo
registry are cached in named volumes (`xr-gdext-target`, `xr-cargo-registry`),
so subsequent boots skip the build.

### Configuration (compose env)

| Var | Default | Purpose |
|-----|---------|---------|
| `XR_PROJECT_ROOT` | `..` | Host path whose `xr-client/` + `crates/` are mounted. `..` works in an integrated checkout (agentbox lives inside the project); set explicitly for a standalone XR checkout. |
| `XR_GODOT_SCENE` | `res://scenes/XRBoot.tscn` | Scene to boot. Set to `res://scenes/GraphScene.tscn` to skip the OpenXR bring-up probe. |
| `XR_RUNTIME_HEADLESS` | `0` | `1` → null compositor (no window). Experimental on NVIDIA; the supported path is visual (`0`). |
| `XR_BACKEND_WS` | `ws://visionclaw_container:4000` | Backend the gdext presence WS / binary protocol connects to. |
| `XR_INPUT_DRIVER` | `simulated` | `simulated` = static stereo HMD (reliable). `qwerty` = keyboard/mouse 6DoF (experimental — see risks). |

## Known risks / boundaries

These are real and documented honestly rather than hidden:

- **NVIDIA proprietary + Monado Vulkan is historically fiddly.** The compositor
  renders through the NVIDIA ICD injected by the container runtime
  (`NVIDIA_DRIVER_CAPABILITIES=…,graphics,display`). If the XCB window fails to
  initialise a swapchain, check `agentbox.sh xr-runtime gpu` (vulkaninfo) and the
  logs; the `XR_RUNTIME_HEADLESS=1` fallback exists but is itself experimental on
  proprietary drivers.
- **Godot version is pinned to 4.3 stable** via the official binary (not Arch's
  `godot` package, which tracks 4.4+). The project declares `config/features` for
  4.3; do not bump the engine without an ADR.
- **Missing action map.** `project.godot` references
  `res://addons/godot_openxr_vendors/openxr_action_map.tres`, but the vendors
  addon is gitignored and Quest-only, so that `.tres` is absent on desktop.
  Godot falls back to its built-in default action map and logs a warning; core
  input still works through the qwerty driver. This is expected, not a failure.
- **Monado is built from AUR (`monado-git`)** and tracks upstream `main`. A
  breaking change there surfaces only on image rebuild. Pin via the AUR cache or
  a vendored PKGBUILD if reproducibility becomes critical.
- **The `qwerty` driver is broken in this Monado build.** It disables the other
  device builders ("Disabling … because we have Qwerty") but then registers no
  head device (`head: <none>, view count: 0`), and the compositor segfaults
  dereferencing the null head. `simulated` is the default for this reason. If a
  future Monado fixes qwerty, flip `XR_INPUT_DRIVER=qwerty` to get interactive
  head movement back.
- **`monado-service` ships with `cap_sys_nice` (file capability).** The
  container won't honour file caps, so exec fails with EPERM until the cap is
  stripped — the Dockerfile does this (`setcap -r`). Don't reintroduce the cap
  without also adding `cap_add: [SYS_NICE]` to the compose.
- **Monado's IPC mainloop epolls stdin** to exit when its terminal closes. Under
  supervisord stdin is non-pollable and init fails fatally, so `launch-monado.sh`
  feeds it a never-closing pipe (`< <(tail -f /dev/null)`). Keep that redirect.
- **Tonemapper shader flood under Forward Mobile + XR multiview.** The XR client
  runs Godot's `mobile` renderer (correct — it must match Quest) with `msaa_3d`
  and `use_xr_shaders`. Against the Monado multiview swapchain, Godot invokes the
  desktop post-process tonemapper effect (`effects/tone_mapper.cpp`), whose
  multiview shader variant is not compiled in the mobile shader set, so it logs
  `shader.is_null()` / `!variants_enabled` every frame. This is **noise, not a
  crash** — the session stays up and the compositor presents at 60 Hz. Do **not**
  silence it by switching the project to the Forward+ renderer: that would diverge
  desktop from device and defeat the validation. It is a genuine engine-level
  finding to chase upstream (or with an ADR) if the stereo render shows artefacts.

## First bring-up findings

The sidecar surfaced several real spec bugs on first launch — each would have
failed identically on a real Quest, none was catchable without an OpenXR runtime:

- **`xr-client/scenes/XRBoot.tscn` declared `DirectionalLight3D` as a
  `[sub_resource]`.** `DirectionalLight3D` is a *Node*, not a *Resource*, so the
  scene failed to parse (`Can't create sub resource of type … not a resource`)
  and would not have loaded on *any* OpenXR runtime, including a real Quest. The
  entry was also dead (never referenced; the actual light is the `AmbientLight`
  node). Removed it and corrected `load_steps`. **FIXED.**
- **`scripts/graph_scene.gd` had two statically-impossible casts / inferences**
  (`XRServer.get_reference_frame() as XROrigin3D` — that returns a `Transform3D`;
  and `load(...).instantiate()` on a `Resource`-typed var). Both are parse-time
  GDScript errors that abort `GraphScene` load. Only visible once the tonemapper
  log flood (below) was filtered. **FIXED** (`_find_xr_camera` rewritten to the
  viewport-camera lookup; avatar template typed as `PackedScene`).
- **gdext cdylib was built `--release` only, but Godot's desktop runtime is a
  *debug* build.** `visionclaw_xr_gdext.gdextension` declares both
  `linux.debug.x86_64` and `linux.release.x86_64`; the debug loader resolves the
  debug path first, which a `--release` build never produces, so the extension
  silently failed to load and **none** of the gdext classes registered. **FIXED**
  in `build-gdext.sh` (link `target/debug/…so → target/release/…so`; the target
  dir is a named volume, so this stays sidecar-local and never touches the
  project). A real Quest sidesteps this only because it ships the Android `.so`.
- **`graph_scene.gd` constructed the gdext classes with `ClassDB.instantiate()`,
  but all five are `#[class(no_init)]`** in Rust and are built through a static
  `create()` factory. `ClassDB.instantiate()` cannot construct a `no_init` class
  (`"… cannot be instantiated"`), so every client was null and the scene mounted
  silently dead. The string-based `class_exists`/`instantiate` guard was *masking*
  the failure. **FIXED** — call `<Class>.create()`; Godot 4.3 `ClassDB` has no
  static-call-by-string, and the cdylib is a hard dependency of this scene, so the
  defensive guard was a fiction. This would have failed identically on a Quest.

### Open finding — the client has no production network transport

The most important discovery, and exactly the "untested architecture / spec may
be wrong" risk this runtime exists to catch. **It is not yet fixed** because it
is a missing subsystem, not a bug, and the fix needs the backend WS protocol +
a real signer — design decisions, not a mechanical repair:

- The gdext godot classes (`BinaryProtocolClient`, `PresenceClientNode`) are pure
  **decoders**: `ingest(bytes)` / `ingest_pose_bytes(bytes)` → decode → emit a
  signal. They hold **no socket**. There is no `connect_to_url`, no `join`.
- `graph_scene.gd` calls `_binary_client.connect_to_url(...)` and
  `_presence_client.join(...)` — methods that **do not exist** on those classes —
  behind `has_method(...)` guards, so they silently no-op.
- `connect_to_server(...)` is **defined but never called** by anything; the
  advertised `XR_BACKEND_WS` env var is **never read** anywhere in the client
  (`ws://` appears in no `.gd`/`.rs` source).
- The crate has a `WsTransport` **port** and a generic `PresenceClient<T,S>`
  core with the NIP-98 handshake/encode logic, but the **only** `WsTransport` and
  `Signer` implementations are `FakeWsTransport` / `FakeSigner` in `ports::fakes`,
  used solely under `#[cfg(test)]`. No production tokio-tungstenite adapter and no
  real Nostr signer exist, and the godot classes never instantiate the core.

Net: the scene mounts and the OpenXR session is healthy, but **nothing ever opens
a WebSocket to the backend** — the client↔backend path is unimplemented end to
end. Building it means: a concrete `tokio-tungstenite` `WsTransport`, a real
`Signer`, wiring a tokio runtime + background recv-pump (→ `call_deferred` →
`ingest`) into the godot classes, plumbing `XR_BACKEND_WS` → `connect_to_server`,
and pinning the backend's binary/presence WS routes + handshake. That is a
feature to scope deliberately, not a blind fix.

## Layout

```
docker-compose.xr-runtime.yml   ← compose definition (this dir's parent)
xr-runtime/
  Dockerfile          ← Arch + Monado (AUR) + pinned Godot 4.3 + rust/clang
  supervisord.conf    ← 4 services: xvfb, x11vnc, monado, godot
  build-gdext.sh      ← cargo build --release of the gdext cdylib
  launch-monado.sh    ← monado-service with qwerty sim HMD (visual/headless)
  launch-godot.sh     ← build-if-missing → wait for Monado → import → run scene
  healthcheck.sh      ← Xvfb + x11vnc + monado-service (godot/GPU warn-only)
  README.md           ← this file
```
