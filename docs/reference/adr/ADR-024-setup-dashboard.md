# ADR-024: Setup Wizard and Operations Dashboard Architecture

**Status:** Accepted
**Date:** 2026-05-22
**Author:** Agentbox team
**Supersedes:** n/a
**Related:** PRD-012 (Setup Dashboard), DDD-009 (Setup Dashboard Domain), ADR-005 (Pluggable Adapter Architecture), ADR-013 (Canonical URI Grammar), ADR-015 (MCP RuVector Mandate)

## TL;DR for newcomers
*Skip if you already know the host-binary dashboard model.*

This ADR records the architecture decisions for `agentbox-setup`, a Rust binary that runs on the host machine and serves a browser-based UI for configuring agentbox before boot and observing it after boot. The central tension is between shipping a rich UI experience (real-time events, charts, schema-validated editing) and keeping host dependencies at zero (no Node, no Python, no Docker socket access from the UI). The shape of the answer is a single static binary embedding all frontend assets, serving them on a random localhost port, and proxying all container API calls server-side so the browser never holds secrets and never needs CORS exceptions. Eight decisions are recorded, from the embedding strategy to the progressive-enhancement model for unavailable services.

**If you remember only one thing:** single binary, server-side proxy, dual-mode lifecycle, zero host dependencies.

---

## Context

Agentbox configuration currently requires hand-editing `agentbox.toml` and reading documentation to understand valid combinations. Once running, operational visibility requires knowing 8+ port numbers and curling individual endpoints. Both experiences are friction points for adoption.

The dashboard must satisfy three hard constraints:

1. **Pre-boot usability.** The wizard must work before any container exists — it edits a local TOML file.
2. **Zero host dependencies.** Users should not install a runtime, package manager, or service to use the tool.
3. **Secret containment.** The management API key (written to `/var/lib/agentbox/secrets/mgmt-key` by the container's bootstrap) must never reach browser JavaScript.

Five alternatives were evaluated:

- **TUI-only (gum/charmbracelet).** Covers pre-boot well but cannot render charts or real-time event streams. Rejected as the sole interface; remains available as a complementary tool.
- **Electron / Tauri app.** Satisfies UI richness but violates the zero-dependency constraint (Electron bundles Chromium; Tauri requires WebView2 on Windows). Over-engineered for what is a localhost status page.
- **WASM SPA served from container.** Only works post-boot; cannot edit TOML pre-boot. Also complicates the build pipeline with a wasm-pack step.
- **Python/Flask host script.** Adds a Python dependency. Rejected.
- **Rust binary with embedded static frontend.** Meets all three constraints. Single binary, no runtime, serves its own assets, proxies API calls.

---

## Decisions

### D1: Rust native binary with embedded static frontend

The `agentbox-setup` binary is compiled with `rust-embed` (or `include_dir`) to bake HTML, CSS, and JS files into the binary at build time. The frontend is vanilla HTML/CSS/JS — no framework, no build step, no transpilation. This keeps the embedded payload small (target < 500 KB compressed) and the binary under 15 MB stripped.

**Rationale.** A framework-less frontend avoids the npm dependency chain entirely. The UI complexity (form fields, cards, a chart, a scrolling log) does not justify React/Vue overhead. CSS custom properties handle theming. `fetch()` handles API calls. A WebSocket handles the event stream. That is the entire frontend stack.

### D2: Server-side API proxy

The binary's HTTP server exposes `/api/*` routes that proxy to the container's management API at `localhost:9090`. The server reads the management API key from a file at startup and injects `Authorization: Bearer <key>` on every proxied request. The browser never sees the key.

```
Browser  --fetch('/api/v1/status')-->  agentbox-setup  --Bearer key-->  localhost:9090/v1/status
```

This eliminates CORS configuration on the management API (which binds to `0.0.0.0:9090` inside the container, mapped to `127.0.0.1:9090` on the host). The proxy is a thin pass-through: request in, headers added, response forwarded, no body transformation.

**Consequence.** The management API does not need to serve CORS headers or know about the dashboard's origin. If a future external client needs direct access, CORS can be added independently.

### D3: DreamLab design tokens for visual consistency

The frontend ships a single `tokens.css` file defining CSS custom properties for the DreamLab design system:

```css
:root {
  --dl-bg-base: #0a0a0f;
  --dl-bg-card: rgba(255, 255, 255, 0.03);
  --dl-brand-amber: #f59e0b;
  --dl-brand-amber-dim: #92400e;
  --dl-text-primary: #e5e7eb;
  --dl-text-secondary: #9ca3af;
  --dl-glass-blur: 12px;
  --dl-glass-border: rgba(255, 255, 255, 0.08);
  --dl-radius: 12px;
  --dl-orb-healthy: #22c55e;
  --dl-orb-degraded: #f59e0b;
  --dl-orb-down: #ef4444;
  --dl-mesh-gradient: radial-gradient(ellipse at 20% 50%, rgba(245, 158, 11, 0.08) 0%, transparent 50%),
                      radial-gradient(ellipse at 80% 20%, rgba(99, 102, 241, 0.06) 0%, transparent 50%);
}
```

All components reference these tokens. No hardcoded colours outside `tokens.css`.

**Consequence.** Theming or white-labelling is a single-file change. The token set is shared with any future DreamLab frontend surface.

### D4: Dual-mode architecture (pre-boot setup vs post-boot dashboard)

The binary detects the container's availability by polling `localhost:9090/health` on a 5-second interval. Two modes:

| Mode | Trigger | Capabilities |
|------|---------|-------------|
| **Pre-boot** | `/health` unreachable | TOML editor, schema validation, section navigation, diff preview. No API proxy routes. |
| **Post-boot** | `/health` returns 200 | Full dashboard: service cards, agent events, metrics, pod health, payment, plus the TOML editor (read-only, showing active config). |

The frontend receives the current mode via a `/api/mode` endpoint that returns `{"mode": "pre-boot"}` or `{"mode": "post-boot"}`. Mode transitions are pushed to the frontend via a Server-Sent Events stream at `/api/mode-stream`, enabling smooth UI transitions without polling.

**Consequence.** The binary is always useful regardless of container state. Users can launch it before, during, or after container startup.

### D5: Zero host dependencies (single static binary, opens system browser)

The binary is statically linked (musl on Linux, native on macOS). It has no runtime dependencies — no libc version requirements, no shared libraries, no config files. On startup it:

1. Binds `127.0.0.1:0` (OS-assigned port).
2. Prints `Dashboard: http://127.0.0.1:<port>` to stdout.
3. Calls `open::that()` to launch the system default browser.

Distribution is a single file: `agentbox-setup-x86_64-linux`, `agentbox-setup-aarch64-linux`, or `agentbox-setup-aarch64-darwin`. No installer, no PATH manipulation, no package manager.

**Consequence.** CI produces three binaries per release. Users download one file and run it.

### D6: Schema-driven TOML editor

The binary embeds a JSON Schema document generated from the `agentbox.toml` grammar. This schema defines every section, field, type, enum value, default, and cross-field constraint. The frontend renders form controls from the schema and validates on every keystroke.

The Rust side uses `toml_edit` for round-trip parsing — preserving comments, whitespace, and ordering — so the wizard does not destroy hand-maintained formatting. Validation runs server-side (`/api/validate` endpoint) using the `jsonschema` crate; the frontend shows results inline but does not duplicate validation logic.

**Consequence.** Adding a new `agentbox.toml` field requires updating one JSON Schema file. The wizard picks it up automatically. Cross-field constraints (e.g. mutual exclusivity, GPU gating) are expressed as `if`/`then` schema combinators.

### D7: WebSocket for real-time agent events

Post-boot mode opens a WebSocket connection from the browser to the binary at `ws://127.0.0.1:<port>/ws/events`. The binary maintains a WebSocket client connection to the container's `/v1/agent-events` endpoint and fans events to all connected browser clients. Event types include task starts/completions, agent spawns/exits, error events, and health-state changes.

The binary buffers the last 200 events in memory so a newly-opened browser tab gets recent history immediately (delivered as a burst on WebSocket open).

**Consequence.** The binary is a WebSocket relay, not a transformer. It adds no fields and removes none. If the container event format changes, the browser receives the new format with no binary update needed.

### D8: Progressive enhancement (dashboard gracefully handles unavailable services)

Not all 8 external surfaces are always available. Jupyter, VNC, code-server, and Nostr relay are conditional features gated by `agentbox.toml`. The dashboard renders a service card for every known surface but degrades gracefully:

| Service state | Card rendering |
|---------------|---------------|
| Healthy (200 on health endpoint) | Green orb, live data, deep-link active |
| Degraded (non-200 but reachable) | Amber orb, last-known data, warning text |
| Unavailable (connection refused) | Grey orb, "Not configured" or "Offline" text, deep-link disabled |
| Feature-gated off | Card hidden entirely (not shown as broken) |

The binary reads `agentbox.toml` to determine which services are feature-gated off (pre-boot knowledge) and passes this to the frontend so it can distinguish "not configured" from "configured but down".

**Consequence.** The dashboard never shows a wall of red for a minimal installation. Users see exactly what they enabled and its actual state.

---

## Consequences

### Positive

- Users get a guided setup experience without reading TOML documentation.
- Operators get a single-pane view of all agentbox services.
- No new container-side code is required; the dashboard consumes existing management API routes.
- Secret containment is structural (server-side proxy), not policy-based.
- The binary is trivially distributable and requires no installation.

### Negative

- The dashboard cannot manage container lifecycle (start/stop/rebuild). This is intentional — lifecycle management belongs to `docker compose` or the host project's launch scripts, not a status dashboard.
- The frameworkless frontend will require more manual DOM manipulation than a React app. Accepted as a trade-off for zero build dependencies and small payload size.
- Three platform binaries must be built and tested in CI. Cross-compilation via `cross-rs` mitigates this.

### Neutral

- The existing TUI wizard (`agentbox.sh wizard`) remains available as a complementary tool for headless environments. The browser UI does not replace it.
- The management API's 63 routes are not all surfaced in v1 of the dashboard. The proxy forwards any `/api/*` call, so future dashboard pages can consume new routes without binary changes.

---

## Appendix: Port Map

| Port | Service | Health Endpoint | Auth |
|------|---------|-----------------|------|
| 9090 | Management API | `/health`, `/ready` | NIP-98 / Bearer |
| 9700 | RuVector | `/health` | None (localhost) |
| 9091 | Prometheus | `/metrics` | None |
| 8484 | Solid Pod | `/.well-known/solid` | WAC |
| 8888 | Jupyter | `/api/status` | Token |
| 5901 | VNC | TCP connect | Password |
| 8080 | code-server | `/healthz` | Password |
| 7777 | Nostr relay | WebSocket handshake | NIP-42 |
