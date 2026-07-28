---
name: meta-xr-sdk
description: >
  Build VR/AR apps for Meta Quest (2/3/3S/Pro) — WebXR in the browser and
  Quest-native spatial apps. Use when building immersive WebXR with Three.js
  or React Three Fiber, mixed reality with passthrough, hand tracking, spatial
  anchors, plane/mesh detection, porting 2D apps to Quest, profiling or
  managing a Quest device, or emulating WebXR without a headset. Meta-ecosystem
  specific; not for generic non-Meta WebXR or plain 3D rendering.
version: 1.0.0
author: agentbox-skills
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

Bridges three surfaces of Meta's VR/AR ecosystem: WebXR web development,
Quest-native Android spatial apps, and AI-assisted agentic workflows via the
hzdb CLI and MCP tools. This guide is the quick path; the full catalog —
toolkit APIs, parameter tables, sample apps, repos, platform matrix — lives in
[`references/ecosystem.md`](references/ecosystem.md).

## When to Use

- **WebXR immersive experiences** for the Quest browser (Three.js, React Three Fiber)
- **Mixed reality** — passthrough, plane/mesh detection, spatial anchors
- **Hand tracking** and controller input for VR/AR
- **Quest-native spatial apps** via Meta Spatial SDK (Android/Kotlin)
- **Porting 2D Android apps** to Quest spatial environments
- **Performance profiling** with Perfetto; store-submission (VRC) checks
- **Device management** (deploy, screenshot, log, shell) via hzdb CLI
- **Desktop WebXR emulation** for headset-free development

## When Not To Use

- General 3D modelling/rendering without VR → `blender`
- Unreal Engine 5 editor automation → `unreal-engine`
- Full game-studio orchestration → `game-dev`
- Pure WASM compute graphics without XR → `wasm-js`
- 3D Gaussian Splatting → `lichtfeld-studio`
- Generic non-Meta WebXR — this skill is Meta-ecosystem-specific

## Quick Path

**WebXR + React (recommended here):**
```bash
npm create vite@latest my-xr-app -- --template react-ts
cd my-xr-app
npm install three @react-three/fiber @react-three/xr ratk iwer @iwer/devui
```

**Device management via hzdb:**
```bash
npx @meta-quest/hzdb mcp server        # MCP server for AI-assisted management
npx @meta-quest/hzdb device list
npx @meta-quest/hzdb app install ./my-app.apk
npx @meta-quest/hzdb perf trace start --duration 10
```

**Mixed reality (passthrough + scene understanding):** request MR features via
`ARButton`, then drive plane/mesh/anchor callbacks with RATK's
`RealityAccelerator`. Full example in
[`references/ecosystem.md`](references/ecosystem.md#mixed-reality-passthrough--scene-understanding).

## The Ecosystem (pointers)

Load [`references/ecosystem.md`](references/ecosystem.md) for detail on:

- **WebXR toolkits** — IWER (emulation), RATK (MR utilities), @react-three/xr,
  with API surfaces and runnable examples
- **Native spatial** — Meta Spatial SDK (ECS, physics, samples), Horizon
  Platform SDK (17 API packages)
- **hzdb CLI + MCP server** — 40+ tools across Device/App/Capture/Perf/Files/
  Docs/Shell/Logs/ADB
- **Unity MCP Extensions** — 10 tools for VR/MR rig, interaction, teleport
- **Agentic VR skills** — Meta's 13 `@meta-quest/agentic-tools` skills
- **npm packages, GitHub repos, platform matrix, WebXR performance targets,
  related skills, external docs**
