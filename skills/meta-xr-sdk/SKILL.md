---
name: "Meta XR SDK"
description: >
  Deep integration with Meta's VR/AR developer ecosystem for Quest 2/3/3S/Pro.
  Covers WebXR (IWER, RATK, @react-three/xr), Meta Spatial SDK (Android),
  Horizon Platform SDK, hzdb CLI (40+ MCP tools), Unity MCP Extensions,
  and agentic VR development skills. Use when building immersive WebXR
  experiences, Quest-native spatial apps, mixed reality with passthrough,
  hand tracking, spatial anchors, plane/mesh detection, or porting 2D apps
  to Quest. Complements wasm-js (WASM compute), game-dev (full studio),
  and unreal-engine (UE5 automation).
version: 1.0.0
author: VisionClaw-Agents
tags:
  - meta-quest
  - webxr
  - vr
  - ar
  - mixed-reality
  - spatial-computing
  - hand-tracking
  - passthrough
  - react-three-xr
  - three-js
  - quest-3
  - iwer
  - ratk
  - hzdb
  - spatial-sdk
mcp_server: true
protocol: stdio
entry_point: "npx @meta-quest/hzdb mcp server"
env_vars:
  - ADB_PATH
  - HZDB_DEVICE_SERIAL
compatibility:
  - "meta-quest-sdk >= 69.0"
  - "node >= 18"
  - "@react-three/xr >= 6.0"
  - "three >= 0.160"
---

# Meta XR SDK

Deep integration with Meta's complete VR/AR developer ecosystem. Bridges
WebXR web development, Quest-native Android spatial apps, and AI-assisted
agentic workflows via hzdb CLI and MCP tools.

## When to Use This Skill

- **WebXR immersive experiences** targeting Meta Quest browser (Three.js, React Three Fiber)
- **Mixed reality** with passthrough, plane detection, mesh detection, spatial anchors
- **Hand tracking** and controller input for VR/AR interactions
- **Quest-native spatial apps** via Meta Spatial SDK (Android/Kotlin)
- **Porting 2D Android apps** to Quest spatial environments
- **Performance profiling** VR apps with Perfetto integration
- **Device management** (deploy, screenshot, log, shell) via hzdb CLI
- **Store submission** validation (VRC checks)
- **AI-assisted VR development** with agentic tools and MCP integration
- **Desktop WebXR emulation** for development without a physical headset

## When Not To Use

- For general 3D modelling/rendering without VR -- use `blender`
- For Unreal Engine 5 editor automation -- use `unreal-engine`
- For full game studio orchestration (48 agents) -- use `game-dev`
- For pure WASM compute graphics without XR -- use `wasm-js`
- For 3D Gaussian Splatting -- use `lichtfeld-studio`
- For non-Meta WebXR (generic spec only) -- this skill is Meta-ecosystem-specific

## Architecture

```
+------------------------------------------------------------------+
|                    Meta XR Developer Ecosystem                    |
+------------------------------------------------------------------+
|                                                                    |
|  +-----------------------+    +------------------------------+    |
|  |    Web Platform        |    |    Native Platform            |    |
|  |                        |    |                              |    |
|  |  @react-three/xr       |    |  Meta Spatial SDK            |    |
|  |  Three.js + WebXR API  |    |  (Android/Kotlin)            |    |
|  |  RATK (mixed reality)  |    |  Entity-Component System     |    |
|  |  IWER (emulation)      |    |  Physics, Animation, Input   |    |
|  +-----------+------------+    +-------------+----------------+    |
|              |                               |                     |
|  +-----------v------------+    +-------------v----------------+    |
|  |  WebXR Feature Modules  |    |  Horizon Platform SDK        |    |
|  |                        |    |  (17 API packages)            |    |
|  |  Hand Input Module     |    |  Achievements, IAP, Social    |    |
|  |  Anchors Module        |    |  Leaderboards, DLC, Cloud     |    |
|  |  Hit Test Module       |    |  Storage, Groups, Parties     |    |
|  |  Plane Detection       |    +------------------------------+    |
|  |  Mesh Detection        |                                       |
|  |  AR Module             |    +------------------------------+    |
|  |  Layers API            |    |  hzdb CLI + MCP Server        |    |
|  |  Gamepads Module       |    |  (40+ tools)                  |    |
|  +-----------------------+    |  Device, App, Capture, Perf    |    |
|                                |  Files, Docs, Shell, Logs      |    |
|                                +------------------------------+    |
+------------------------------------------------------------------+
|                    Quest 2 / 3 / 3S / Pro                         |
+------------------------------------------------------------------+
```

## Meta's SDK Ecosystem (Complete Inventory)

### 1. WebXR Development

#### IWER -- Immersive Web Emulation Runtime
Desktop WebXR emulation without a physical headset.

```bash
npm install iwer @iwer/devui @iwer/sem
```

| WebXR Module | Support |
|---|---|
| WebXR Device API | Full |
| Gamepads Module | Full |
| Hand Input Module | Full |
| Augmented Reality Module | Full |
| Hit Test Module | Full |
| Plane Detection | Full |
| Mesh Detection | Full |
| Anchors Module | Full |
| Layers API | Polyfill |

**Key classes:** `XRDevice`, `XRController`, `XRHandInput`

```javascript
// IWER auto-emulation setup (falls back when no native WebXR)
import { XRDevice } from 'iwer';
import { DevUI } from '@iwer/devui';

const xrDevice = new XRDevice();
xrDevice.installRuntime();
new DevUI(xrDevice);
```

#### RATK -- Reality Accelerator Toolkit
Mixed reality utilities bridging WebXR and Three.js.

```bash
npm install ratk three
```

**Core class:** `RealityAccelerator`
**Detected objects:** `Plane`, `RMesh`, `Anchor`, `HitTestTarget` (all extend `Object3D`)

```javascript
import { RealityAccelerator } from 'ratk';

const ratk = new RealityAccelerator(renderer.xr);
scene.add(ratk.root);

// Plane detection
ratk.onPlaneAdded = (plane) => {
  plane.material = new MeshBasicMaterial({ wireframe: true });
};

// Spatial anchors
const anchor = await ratk.createAnchor(position, quaternion, true); // persistent

// Hit testing
const hitTarget = ratk.createHitTestTargetFromControllerSpace('right');

// Must call each frame
function animate() {
  ratk.update();
}
```

**API surface:**

| Class | Key Methods |
|---|---|
| `RealityAccelerator` | `createAnchor()`, `restorePersistentAnchors()`, `createHitTestTargetFromControllerSpace()`, `createHitTestTargetFromViewerSpace()`, `update()` |
| `Plane` | `.semanticLabel`, `.orientation`, auto-geometry |
| `RMesh` | Environment mesh reconstruction |
| `Anchor` | `.isPersistent`, position/rotation |
| `HitTestTarget` | Hit test results as Object3D |
| `ARButton` / `VRButton` | Session initialisation |

#### @react-three/xr -- React Three Fiber XR
Declarative WebXR for React applications.

```bash
npm install three @react-three/fiber @react-three/xr@latest
```

```tsx
import { Canvas } from '@react-three/fiber';
import { createXRStore, XR } from '@react-three/xr';

const store = createXRStore();

function App() {
  return (
    <>
      <button onClick={() => store.enterVR()}>Enter VR</button>
      <button onClick={() => store.enterAR()}>Enter AR</button>
      <Canvas>
        <XR store={store}>
          <mesh pointerEventsType={{ deny: 'grab' }} onClick={handleClick}>
            <boxGeometry />
            <meshStandardMaterial color="hotpink" />
          </mesh>
        </XR>
      </Canvas>
    </>
  );
}
```

**Capabilities:** Hand tracking, controllers, hit testing, anchors, teleportation,
DOM overlays, layers, guards, gamepad input, origin management, object detection.

### 2. Native Spatial Development

#### Meta Spatial SDK (Android)
Quest-native apps with Android Studio.

**Entity-Component System** with auto-save DSL:
- Spatial anchors and scene understanding
- Physics (ball socket, cone twist, fixed, hinge, slider, spring constraints)
- Blended animation with delta-time playback
- Mixed reality passthrough integration
- Body tracking, hand tracking
- Spatial video and media playback

**Requires:** Quest device v69.0+, Android Studio Hedgehog+

**Reference apps:** Focus, Media View, Geo Voyage, Spatial Scanner

**15+ samples:** AnimationsSample, BodyTrackingSample, CustomComponentsSample,
HybridSample, MediaPlayerSample, MixedRealitySample, MrukSample, Object3DSample,
PhysicsSample, SpatialVideoSample, StarterSample, UISetSample, FeatureDevSample

#### Horizon Platform SDK (17 API packages)
Social platform integration for Quest apps:
Achievements, IAP, Social, Leaderboards, DLC, Cloud Storage, Groups, Parties

### 3. hzdb CLI + MCP Server (40+ Tools)

The Horizon Debug Bridge provides direct device and app management.

```bash
# Install and run MCP server
npx @meta-quest/hzdb mcp server

# Or install globally
npm install -g @meta-quest/hzdb
```

**Command groups:**

| Group | Capabilities |
|---|---|
| Device | List, connect, reboot, info |
| App | Install, launch, stop, uninstall, inspect |
| Capture | Screenshots |
| Files | Push, pull, delete |
| Performance | Perfetto tracing and profiling |
| Docs | Documentation search |
| Assets | Asset library search |
| Config | Device configuration |
| Logs | Device logging |
| Shell | Remote shell commands |
| ADB | Direct ADB passthrough |

### 4. Unity MCP Extensions

10 MCP tools for Unity VR/MR development:

**Core SDK (3 tools):**
- `meta_add_camerarig` -- VR/MR camera rig setup
- `meta_get_config_information` -- Configuration retrieval
- `meta_update_android_manifest` -- Manifest updates

**Interaction SDK (7 tools):**
- `meta_add_canvas_interaction_poke` -- UI poke interactions
- `meta_add_canvas_interaction_ray` -- Distance UI ray interactions
- `meta_add_distance_grabbable` -- Distance grab mechanics
- `meta_add_grabbable` -- Standard grab setup
- `meta_add_interactionrig` -- Interaction rig
- `meta_add_teleport_hotspot` -- Teleport points
- `meta_get_interactors_state` -- Interactor status

**Requires:** Meta Core SDK v78+, Meta Interaction SDK v78+, Unity AI Gateway Beta

### 5. Agentic VR Development Skills (13 Skills)

Meta's `@meta-quest/agentic-tools` provides AI-assisted development:

| Skill | Purpose |
|---|---|
| `hzdb-cli` | CLI reference and MCP server setup |
| `hz-perfetto-debug` | VR performance profiling with Perfetto |
| `hz-new-project-creation` | Project scaffolding (Unity, Unreal, Spatial SDK, WebXR) |
| `hz-xr-simulator-setup` | Emulation without physical device |
| `hz-unity-code-review` | Unity performance optimisation guidance |
| `hz-android-2d-porting` | Android-to-Quest migration |
| `hz-iwsdk-webxr` | Immersive Web SDK integration |
| `hz-api-upgrade` | SDK version migration |
| `hz-immersive-designer` | VR/MR UX design principles |
| `hz-spatial-sdk` | Native spatial app development |
| `hz-vr-debug` | Debugging via hzdb CLI |
| `hz-vrc-check` | Store publishing validation |
| `hz-platform-sdk` | Horizon Platform SDK (17 API packages) |

**Works with:** Claude Code, GitHub Copilot CLI, Cursor

## Quick Start Recipes

### WebXR + React (Recommended for This Project)

```bash
# New project
npm create vite@latest my-xr-app -- --template react-ts
cd my-xr-app
npm install three @react-three/fiber @react-three/xr ratk iwer @iwer/devui
```

### WebXR + Vanilla Three.js

```bash
npm init -y
npm install three ratk iwer @iwer/devui webpack webpack-cli webpack-dev-server
```

### Device Management

```bash
# Start MCP server for AI-assisted device management
npx @meta-quest/hzdb mcp server

# Direct CLI usage
npx @meta-quest/hzdb device list
npx @meta-quest/hzdb app install ./my-app.apk
npx @meta-quest/hzdb capture screenshot
npx @meta-quest/hzdb perf trace start --duration 10
```

### Mixed Reality (Passthrough + Scene Understanding)

```javascript
import { RealityAccelerator } from 'ratk';
import { ARButton } from 'ratk';

// Request MR features
const sessionInit = {
  requiredFeatures: ['local-floor', 'hand-tracking'],
  optionalFeatures: ['plane-detection', 'mesh-detection', 'anchors', 'hit-test']
};

document.body.appendChild(ARButton.createButton(renderer, sessionInit));

const ratk = new RealityAccelerator(renderer.xr);
scene.add(ratk.root);

ratk.onPlaneAdded = (plane) => {
  console.log(`Detected: ${plane.semanticLabel} (${plane.orientation})`);
};

ratk.onMeshAdded = (mesh) => {
  mesh.material = new MeshBasicMaterial({ wireframe: true, color: 0x00ff00 });
};
```

## npm Packages Reference

| Package | Purpose |
|---|---|
| `iwer` | WebXR emulation runtime |
| `@iwer/devui` | Developer UI overlay for IWER |
| `@iwer/sem` | Synthetic Environment Module for MR emulation |
| `ratk` | Reality Accelerator Toolkit (Three.js MR utilities) |
| `@react-three/xr` | React Three Fiber XR integration |
| `@react-three/fiber` | React renderer for Three.js |
| `three` | 3D rendering library |
| `@meta-quest/hzdb` | Horizon Debug Bridge CLI + MCP server |

## GitHub Repositories

| Repository | Description |
|---|---|
| [meta-quest/immersive-web-emulation-runtime](https://github.com/meta-quest/immersive-web-emulation-runtime) | IWER core runtime |
| [meta-quest/immersive-web-emulator](https://github.com/meta-quest/immersive-web-emulator) | Browser extension for WebXR emulation |
| [meta-quest/reality-accelerator-toolkit](https://github.com/meta-quest/reality-accelerator-toolkit) | RATK mixed reality utilities |
| [meta-quest/agentic-tools](https://github.com/meta-quest/agentic-tools) | AI-assisted VR development (13 skills, 40+ MCP tools) |
| [meta-quest/Meta-Spatial-SDK-Samples](https://github.com/meta-quest/Meta-Spatial-SDK-Samples) | Native spatial SDK samples |
| [meta-quest/Unity-MCP-Extensions](https://github.com/meta-quest/Unity-MCP-Extensions) | Unity MCP tools for VR |
| [meta-quest/ProjectFlowerbed](https://github.com/meta-quest/ProjectFlowerbed) | WebXR reference game (Three.js ECS) |
| [meta-quest/webxr-first-steps](https://github.com/meta-quest/webxr-first-steps) | WebXR tutorial (vanilla Three.js) |
| [meta-quest/webxr-first-steps-react](https://github.com/meta-quest/webxr-first-steps-react) | WebXR tutorial (React Three Fiber) |
| [meta-quest/spatial-web-template](https://github.com/meta-quest/spatial-web-template) | WebXR starter template |
| [pmndrs/react-xr](https://github.com/pmndrs/react-xr) | @react-three/xr (community + Meta supported) |

## Platform Support

| Device | WebXR | Native SDK | Horizon Platform |
|---|---|---|---|
| Quest 2 | Full | v69+ | Full |
| Quest 3 | Full | v69+ | Full |
| Quest 3S | Full | v69+ | Full |
| Quest Pro | Full | v69+ | Full |
| Desktop (IWER) | Emulated | N/A | N/A |

## Performance Targets (WebXR on Quest)

| Metric | Target | Notes |
|---|---|---|
| Frame rate | 72/90/120 Hz | Match device refresh rate |
| Draw calls | <100 | Batch geometry, use instancing |
| Triangle count | <500K visible | LOD and occlusion culling |
| Texture memory | <256MB | Compress with KTX2/Basis |
| JS frame budget | <11ms (90Hz) | Offload compute to WASM or workers |
| Latency (motion-to-photon) | <20ms | Critical for comfort |

## Related Skills

| Skill | Relationship |
|---|---|
| `wasm-js` | WASM compute backend for XR rendering pipelines |
| `game-dev` | Full game studio (48 agents) -- use for complete game projects |
| `unreal-engine` | UE5 editor automation -- use for Unreal-based Quest apps |
| `blender` | 3D asset creation for XR scenes |
| `lichtfeld-studio` | 3D Gaussian Splatting for volumetric XR content |
| `comfyui` | AI-generated textures and assets for XR environments |
| `playwright` | Automated testing of WebXR UI overlays |
| `rust-development` | Rust toolchain for WASM modules in XR apps |

## References

- [Meta Quest Developer Docs](https://developers.meta.com/horizon)
- [WebXR Device API Spec](https://www.w3.org/TR/webxr/)
- [IWER Documentation](https://meta-quest.github.io/immersive-web-emulation-runtime/)
- [RATK Documentation](https://meta-quest.github.io/reality-accelerator-toolkit/)
- [React Three XR Docs](https://pmndrs.github.io/xr/)
- [Three.js Documentation](https://threejs.org/docs/)
- [Project Flowerbed Case Study](https://developer.oculus.com/blog/project-flowerbed-a-webxr-case-study/)
