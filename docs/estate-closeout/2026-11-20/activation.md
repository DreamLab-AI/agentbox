# Core tools and browser activation — 2026-11-20

Agentbox source: `559c2c39e2f5e8087d890b6ea89d63a75be1940b` (clean, pushed).
Active image: `sha256:b51f2286bda3610de732c8e21edf4186c06583e39d2b3d1211cdba5d7dba2f72`.
Cutover: 12:17:11 UTC. This receipt is a subsequent documentation-only commit.

Live tools: Codex 0.171.0, Claude Code 2.1.329, Antigravity 1.5.13,
Ruflo 3.77.1 and ARTEX Defense 0.1.0. Ruflo includes aidefence 3.2.1;
neither addition starts a gateway or intercepts messages. New Ruflo learning
and retention defaults stay off. The existing main-model choice was preserved;
no paid model evaluation was run.

Browser: Chrome Beta 159.0.8154.13, Chromium 158.0.8127.36, MCP 1.13.0,
ws 8.23.0, FFmpeg 9.1. Display/GPU checks and an isolated-display H.264
recording passed. Usage statistics, update checks and performance CrUX URL
exports are off. Captured live tool schemas now gate browser examples in CI.
After final cutover, a background fixture passed real MCP upload and screenshot
handoff through the exchange mount, without capturing the operator's page.

Core postchecks passed: supervised services, reviewed persistent mounts,
RuVector MCP memory health, terminal truecolor activity/telemetry, CUDA,
NVENC and sidecar QGIS. Startup settled after the hub's 130-second start window
and producer initialisation. The remaining readiness warning is the pre-existing
owner-parked elevation publisher with no signing stack; zero proposals skipped
or failed. All non-Agentbox container IDs survived the final cutover unchanged.

The final small refresh reused four layers and changed only the application
layer: build 118.753 s, registry setup 0.262 s, push 11.459 s, pull 65.937 s,
smoke 0.583 s (196.994 s total). Earlier native package warmup and first
deployment are separate costs, not included in that figure. About 104 GiB
remains free on the shared build/data disk. No garbage collection, Docker
pruning or cache/data-volume deletion was performed; recovery images remain.

## Explicit limits

- Podkey cannot load under the existing wildcard extension blocklist. No
  policy was weakened and no signing secret was accessed. Owner policy choice
  is still required; VNC web login alone does not solve the extension block.
- Existing insecure-origin placeholders, passwordless sudo and floating
  browser base/package inputs remain open owner/security decisions (ADR-2207).
- The parent project has an unrelated 63-commit unpublished backlog. It was not
  pushed merely to publish an Agentbox submodule pointer; its gitlink remains
  for that repository's coordinated release.
- Source and lock audits retain the residual findings documented in the
  source review; this is not a clean whole-image vulnerability certification.
