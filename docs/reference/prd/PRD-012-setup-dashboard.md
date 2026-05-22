# PRD-012: Agentbox Setup Wizard and Operations Dashboard

**Status:** Draft v1
**Date:** 2026-05-22
**Author:** Agentbox team
**Related:** ADR-024 (Setup Dashboard), DDD-009 (Setup Dashboard Domain), PRD-001 (Capabilities and Adapters), ADR-005 (Pluggable Adapter Architecture), ADR-013 (Canonical URI Grammar)

## TL;DR for newcomers
*Skip if you already know the dual-mode host binary model.*

This PRD describes `agentbox-setup`, a Rust native binary that runs on the **host machine** (not inside the container) and serves a browser-based UI for two distinct lifecycle phases. **Pre-boot mode** is a setup wizard that edits `agentbox.toml` with full JSON Schema validation before the container starts — no running container required. **Post-boot mode** is an operations dashboard that connects to the container's management API on port 9090 and surfaces service status, agent events, metrics, pod health, and payment state. The binary embeds all static assets (HTML/CSS/JS), serves them on a random localhost port, and opens the system browser. It proxies all API calls server-side to avoid CORS and to keep the management API key out of the browser.

**If you remember only one thing:** one binary, two modes — edit the manifest before boot, observe the running system after boot.

---

## 1. Goals

| ID | Goal | Success Metric |
|----|------|----------------|
| G1 | Eliminate manual TOML editing for first-time users | 90% of new users complete setup without touching a text editor |
| G2 | Provide real-time operational visibility into a running agentbox | All 8 external surfaces visible from a single pane |
| G3 | Zero host dependencies beyond the binary itself | Single static binary, no runtime, no installer, no PATH manipulation |
| G4 | Keep secrets server-side | Management API key never reaches browser JS |
| G5 | Visual consistency with DreamLab design system | All components use shared design tokens (glassmorphism, amber brand, dark theme) |

---

## 2. User Stories

| ID | As a... | I want to... | So that... |
|----|---------|-------------|------------|
| US1 | New user | Walk through agentbox.toml section-by-section with validation | I get a valid manifest without reading the spec |
| US2 | Operator | See which services are healthy at a glance | I know the system is ready before sending work |
| US3 | Developer | Watch agent events in real time | I can debug orchestration without tailing logs |
| US4 | Operator | View Prometheus metrics as charts | I spot resource trends without a separate Grafana stack |
| US5 | Operator | Check pod health and storage utilisation | I know when Solid pod storage needs attention |
| US6 | User | Toggle optional features (GPU, desktop, skills) with immediate validation | I avoid invalid feature combinations |
| US7 | Operator | See payment/marketplace status | I verify LLM resource billing is operational |
| US8 | Developer | Access the dashboard without installing anything | I run a single binary and a browser opens |

---

## 3. Functional Requirements

### Pre-boot Mode (Setup Wizard)

| ID | Requirement | Priority |
|----|-------------|----------|
| F01 | Parse and display `agentbox.toml` grouped by section (`[core]`, `[federation]`, `[adapters]`, `[gpu]`, `[desktop]`, `[providers.*]`, `[skills.*]`, `[linked_data]`) | P0 |
| F02 | Validate every field against a JSON Schema derived from the TOML grammar; show inline errors | P0 |
| F03 | Enforce cross-field constraints (e.g. `gaussian_splatting` requires `gpu.backend = "local-cuda"`, `comfyui_builtin` and `comfyui_external` are mutually exclusive) | P0 |
| F04 | Write changes back to `agentbox.toml` preserving comments and formatting (TOML-edit round-trip) | P0 |
| F05 | Section-by-section navigation with progress indicator | P1 |
| F06 | Show a diff preview before writing changes | P1 |
| F07 | Detect existing `agentbox.toml` on startup; create from template if absent | P1 |
| F08 | Provide reset-to-defaults per section | P2 |
| F09 | Export the current manifest as a shareable snippet (TOML or base64-encoded) | P2 |

### Post-boot Mode (Operations Dashboard)

| ID | Requirement | Priority |
|----|-------------|----------|
| F10 | Detect container availability by polling `localhost:9090/health` | P0 |
| F11 | Display service cards for all 8 external surfaces with health status (healthy/degraded/unavailable) | P0 |
| F12 | Stream agent events from `/v1/agent-events` via WebSocket and display as a live feed | P0 |
| F13 | Show task list from `/v1/tasks` with status, timing, and agent assignment | P0 |
| F14 | Display system status from `/v1/status` (uptime, profile, adapter states, feature gates) | P0 |
| F15 | Scrape Prometheus metrics from `localhost:9091/metrics` and render time-series charts for CPU, memory, request rate | P1 |
| F16 | Show memory store summary from `/v1/memory` (entry count, namespaces, storage size) | P1 |
| F17 | Display pod health from Solid pod endpoint (`localhost:8484`) — storage used, container count, WAC status | P1 |
| F18 | Show LLM marketplace and payment info from `/v1/pay/*` and `/v1/llm/*` routes | P1 |
| F19 | Display ComfyUI backend status from `/v1/comfyui/*` when enabled | P2 |
| F20 | Show git integration status from `/v1/git/*` | P2 |
| F21 | Link to Linked Objects viewer at `/lo/*` when `[linked_data.viewer]` is enabled | P2 |
| F22 | Auto-switch from pre-boot to post-boot mode when container becomes available | P1 |

### Binary / Infrastructure

| ID | Requirement | Priority |
|----|-------------|----------|
| F23 | Single statically-linked Rust binary with embedded static assets (HTML/CSS/JS via `rust-embed` or `include_dir`) | P0 |
| F24 | Bind to `127.0.0.1` on a random available port; print URL to stdout | P0 |
| F25 | Open system default browser automatically (`xdg-open` / `open` / `start`) | P1 |
| F26 | Proxy all management API calls server-side; inject `Authorization: Bearer <key>` header | P0 |
| F27 | Read API key from `/var/lib/agentbox/secrets/mgmt-key` (configurable via `--key-file` flag) | P0 |
| F28 | Graceful shutdown on SIGINT/SIGTERM; clean up bound port | P0 |

---

## 4. Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NF1 | Binary size | < 15 MB stripped |
| NF2 | Startup to browser open | < 500 ms |
| NF3 | Dashboard page load (cached) | < 200 ms |
| NF4 | Health poll interval | 5 seconds (configurable) |
| NF5 | WebSocket reconnect | Exponential backoff, max 30 s |
| NF6 | Supported platforms | Linux x86_64, Linux aarch64, macOS arm64 |
| NF7 | Accessibility | WCAG 2.1 AA for all interactive elements |

---

## 5. Security Requirements

| ID | Requirement |
|----|-------------|
| S1 | All listeners bind to `127.0.0.1` only — no network exposure |
| S2 | Management API key never sent to browser; server binary proxies all authenticated requests |
| S3 | Pre-boot mode performs no network I/O; it reads and writes local files only |
| S4 | CSP headers on all served pages: `default-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'` |
| S5 | No eval, no inline scripts; all JS served as static files |
| S6 | Key file permissions checked at startup; warn if world-readable |

---

## 6. UI/UX Requirements

| ID | Requirement |
|----|-------------|
| U1 | DreamLab design system: dark theme (`#0a0a0f` base), amber brand (`#f59e0b` primary), glassmorphism cards (`backdrop-filter: blur(12px)`), mesh gradient backgrounds |
| U2 | Ambient orbs as subtle status indicators (green=healthy, amber=degraded, red=down) |
| U3 | Responsive layout: single-column on narrow viewports, grid on wide |
| U4 | Service cards show: name, port, health status orb, last-checked timestamp, and a deep-link to the service URL |
| U5 | Agent event feed: newest-first, auto-scroll, pause button, event-type filtering |
| U6 | TOML editor: syntax-highlighted preview pane alongside form inputs |
| U7 | Smooth transitions between pre-boot and post-boot modes (no full page reload) |
| U8 | Skeleton loaders for all async data; no layout shifts |

---

## 7. Dependencies

| Dependency | Role | Version Constraint |
|------------|------|--------------------|
| `axum` | HTTP server | >= 0.8 |
| `rust-embed` or `include_dir` | Static asset embedding | latest stable |
| `toml_edit` | Round-trip TOML parsing | >= 0.22 |
| `jsonschema` | TOML validation against JSON Schema | >= 0.27 |
| `tokio-tungstenite` | WebSocket client for agent events | >= 0.24 |
| `reqwest` | HTTP client for management API proxy | >= 0.12 |
| `serde` / `serde_json` | Serialisation | latest stable |
| `open` | System browser launch | >= 5.0 |

---

## 8. Milestones

| Milestone | Scope | Target |
|-----------|-------|--------|
| M1 | Pre-boot wizard: TOML parsing, schema validation, section navigation, write-back | Week 1-2 |
| M2 | Binary infrastructure: embedded assets, localhost server, browser launch, proxy skeleton | Week 2-3 |
| M3 | Post-boot dashboard: service cards, health polling, status display | Week 3-4 |
| M4 | Real-time: WebSocket agent events, task list, live feed | Week 4-5 |
| M5 | Metrics and extended surfaces: Prometheus charts, pod health, payment, ComfyUI, git | Week 5-6 |
| M6 | Polish: design tokens, transitions, accessibility audit, binary size optimisation | Week 6-7 |

---

## 9. Out of Scope

- Remote access (dashboard is localhost-only by design).
- Container lifecycle management (start/stop/rebuild). The binary observes, it does not control.
- Editing secrets or credentials through the UI. Secret paths are configured; values are opaque.
- Mobile-optimised layout (desktop browser is the target).
