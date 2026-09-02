---
title: Agentbox Container Baseline
doc_id: AB-BASELINE
version: 0.2.0
status: draft-for-ratification
verified_commit: 73540faa0
changelog:
  - 0.2.0 (2026-09-02) — ADR-2028/2029: [vault] manifest section is the single corpus path authority (entrypoint exports VAULT_ROOT/VAULT_PAGES/VAULT_FORMAT/VAULT_TUI; system-manifest reports the resolved vault as two entries, vault=boot and vault-tui=rebuild); tmux window 9 "Notes" row added.
  - 0.1.1 (2026-08-31) — correct AoE :9095 to --auth token (live at 73540faa0, was mis-stated as --auth none/staged); boot-probe non-orchestrator failure sets health 'degraded' (impl→off), not 'off'.
sources:
  - agentbox/flake.nix
  - agentbox/lib/gpu-wrap.nix
  - agentbox/management-api/lib/system-manifest.js
  - agentbox/config/entrypoint-unified.sh
  - agentbox/schema/agentbox.toml.schema.json
  - agentbox/scripts/ci/check-no-logseq-paths.sh
  - agentbox/management-api/adapters/index.js
  - agentbox/management-api/adapters/base.js
  - agentbox/management-api/adapters/contract-versions.js
  - agentbox/management-api/server.js
  - agentbox/skills/mcp.json
  - agentbox/scripts/project-mcp-servers.mjs
  - agentbox/schema/agentbox.toml.schema.json
  - agentbox/docs/reference/adr/ADR-005-pluggable-adapter-architecture.md
date: 2026-08-31
---

# Agentbox Container Baseline

## Purpose

Ground-truth description of how the agentbox container is composed and what runs inside it: the Nix image, the supervised process set, the five-slot adapter spine and its validation policy, the GPU wrappers, the compose sidecars, the manifest gate catalogue, and the MCP projection. Read the code, not the legacy ADRs, when they disagree.

## Current State

### Build: one Nix flake

The image is composed entirely by `flake.nix` (3,297 lines). `agentbox.toml` is the *running* configuration, not a template — the flake evaluator reads it at build time to decide the package set and generates the supervisord text inline. Feature gates map to Nix conditionals (`lib.optionalString`), so flipping most gates changes the image and needs `./agentbox.sh rebuild`, not a restart. This is the apply-class distinction the manifest surface encodes (`system-manifest.js:27-31`): `live` (read at op time), `boot` (entrypoint reconciles each restart), `rebuild` (changes Nix composition).

`ruvector` is always in the package set (`flake.nix:196`), pinned as an exact-semver Nix npm closure (`ruvector-0.2.25`, `lib/npm-cli.nix`); everything else is gated. Node is `nodejs_22` throughout.

### Supervised services (real `[program:*]` blocks in flake.nix)

Supervisord runs as PID 1 root; every long-running program drops to `user=devuser`. Enumerated from the generated supervisor text:

| Program | Role | Port (bind) |
|---|---|---|
| `management-api` (`:1766`) | Fastify control plane; `AGENTBOX_REQUIRED_FOR_READINESS` | `$MANAGEMENT_API_PORT` (4000) |
| `bootstrap` / `bootstrap-seal` (`:1752`,`:1782`) | boot reconcile + one-shot readiness seal writing `/run/agentbox/bootstrap.done` | — |
| `aoe-serve` (`:1971`) | Agent-of-Empires interaction plane, `--auth token --behind-proxy` | `127.0.0.1:9095` (never published) |
| `nip98-proxy` (`:1993`) | sole NIP-98 ingress to `:9095`, multi-upstream `/mgmt/*` router | `:9096` (LAN-published) |
| `tab0-bridge` (`:2023`) | voice/nostr meta-controller for tmux window 0 | `:8971` |
| `tmux-autostart` (`:2036`) | primary operator terminal surface; window 0 is the tab0-bridge target, window 9 **"Notes"** is the vault TUI | — |
| └ window 9 "Notes" | Rune markdown TUI opened at `$VAULT_ROOT` when `[vault].tui = "rune"` and the binary is present; otherwise prints the same rebuild notice the Sessions window uses (ADR-2029) | — |
| `solid-pod` (`:1794`) | solid-pod-rs sovereign storage, NIP-98 | `127.0.0.1:8484` |
| `https-bridge` (`:1811`) | pod HTTPS bridge | — |
| `nostr-relay` (`:1848`/`:1860`) | sovereign relay | `7777` (gated expose) |
| `nostr-gateway` (`:1567`) | nostr gateway | — |
| `opf-router` (`:1873`) | OpenAI-compatible façade router | `:8084` |
| `ruvector-aggregate-sweep` / `ruvector-pattern-distill` (`:1550`,`:1579`) | memory sweep + distil loops | — |
| `ontology-condense-scheduler` (`:1597`) | ontology condensation | — |
| `dream-engine` (`:1948`) | ADR-052 nightly repo evolution (boot-class gate) | — |
| `jupyter-lab` (`:1610`) | notebook surface (gated) | `127.0.0.1:8888` |
| `code-server` (`:1909`) | web VS Code (gated) | `0.0.0.0:8080` |
| `comfyui-builtin` (`:1926`) | image workflows (gated) | `127.0.0.1:8188` |
| `qgis-mcp` / `blender-mcp` / `imagemagick-mcp` (`:1514`,`:1539`,`:1825`) | GPU/media MCP servers (gated) | `9877`, `9876`, — |
| `xvnc` / `x11vnc` / `wayvnc` / `xorg-nvidia` / `hyprland` / `i3wm` / `xwayland-session` (`:1610`-`:1723`) | desktop stack (gated `desktop.enabled`) | `127.0.0.1:5901` |
| `tailscaled` / `tailscale-up` (`:1886`,`:1896`) | mesh networking (gated) | — |
| `podcast-cron` / `forum-backup-cron` (`:2047`,`:2065`) | scheduled jobs | — |

Readiness (`server.js:508`) requires `bootstrap.done`, `adapters:healthy`, and `paths:accessible`; `bootstrap-seal` is a one-shot at `priority=99` — if it times out `/ready` stays 503.

### Adapter spine — five slots, three classes, four validation stages

The durable-state spine is the five-slot adapter pattern (legacy ADR-005): slots `beads, pods, memory, events, orchestrator` (`adapters/index.js:17`, `system-manifest.js:267`). Each resolves at boot to one of three implementation classes — a local class (`local-*`/`embedded-*`), a federated class (`external`/`external-pg`/`stdio-bridge`), or `off`. Every dispatch is wrapped observability → privacy → JSON-LD (`instrumentAdapter`, `index.js:131`).

The reviewer flag stands: ADR-005 conflates four *separate* validation stages that live in different code and fire at different times. The actual policy:

1. **Static schema validation** — `schema/agentbox.toml.schema.json` + `scripts/agentbox-config-validate.js` reject a malformed manifest before build; ADR-005 `W0xx` warnings flag dead policy (e.g. `W041`, ADR-005:128). Stage output: a valid gate set. Runs at edit/build time.
2. **Boot probe** — `server.js:1206` connects all five slots under a 10 s total budget; success sets `adapterHealth[slot]='healthy'`, failure sets `adapterHealth[slot]='degraded'` and hot-swaps the slot's live implementation to the `off` impl (so callers get `AdapterDisabled` rather than broken state — note the health string is `degraded`, not `off`) — **except orchestrator, whose connect failure is FATAL and `process.exit(1)`** (`server.js:1219`, `:1223`). Runs once per boot.
3. **Conformance** — one contract suite per concern under `tests/contract/*.contract.spec.js` (memory, pods, events, beads, orchestrator, …) asserts all three implementation classes behave identically. Runs in CI, not at boot.
4. **SLO** — per-slot p95 latency / throughput / error-rate targets (ADR-005:157-161) surfaced as the `agentbox_adapter_health` gauge ∈ {0,1,2} and `agentbox_adapter_dispatch_total` / `_duration_seconds` on `/metrics`; `agentbox.sh health` exits non-zero if any slot's gauge is 0. Runs continuously.

Contract versions are pinned per slot (`contract-versions.js`): beads `1.1.0`, pods/memory/events/orchestrator `1.0.0`.

### GPU wrappers — CUDA yes, Vulkan no

Nix binaries carry absolute nix-store RUNPATHs and never search `/usr/lib`, which is exactly where the nvidia-container-toolkit injects the host userspace driver (`libcuda.so.1`, `libGLX_nvidia`, …). Unwrapped, every Nix GPU binary fails to `dlopen` libcuda and silently falls back to CPU (`lib/gpu-wrap.nix:8-16`). The fix is nixGL-class: `wrapGpuBins` / `wrapGpuBinsAll` `symlinkJoin`-wrap the named bins with `--suffix LD_LIBRARY_PATH` appending `/usr/lib:/usr/lib/x86_64-linux-gnu:/run/opengl-driver/lib`, plus `__GLX_VENDOR_LIBRARY_NAME=nvidia`, EGL/Vulkan ICD defaults (`gpu-wrap.nix:46-66`). `--suffix` not `--prefix` keeps Nix's own libstdc++/libc authoritative to avoid ABI shadowing.

Applied only when `gpu.backend == "local-cuda"` (`flake.nix:170`); on `backend=none` packages pass through unwrapped. Wrapped targets (`flake.nix:976-996`): ffmpeg (`ffmpeg`/`ffprobe`/`ffplay`), qgis, blender, and all 3DGS/gaussian-splatting tools (`wrapGpuAll`, since colmap/lichtfeld bin names aren't pinned). Produces `-gpuwrapped` derivations, drop-in for the originals. Proven live 2026-08-31 on RTX A6000 + 2×RTX 6000 Ada (`gpu-wrap.nix:28-30`).

**Limitation:** the wrapper delivers CUDA compute; it is a *library-path* fix, not a Vulkan/GLX presentation fix. Interactive GL/Vulkan display goes through the FHS gui-tools sidecar under `vglrun`, not the wrapped Nix bins — the nixGL-class approach resolves the driver `.so` but does not give a Nix binary a working windowing/Vulkan-WSI surface.

### Sidecars (compose, own lifecycle)

Not supervised inside the box — external compose services on `visionclaw_network`, managed via `./agentbox.sh <name>`:

- **browsercontainer** — GPU Chrome, chrome-devtools-mcp at `:8931/sse` (`system-manifest.js:154`, apply-class `live`).
- **gui-tools-service** — FHS GPU sidecar for BlenderMCP `:9876` and QGIS `:9877` under `vglrun` (`:157`).
- **voice-console** — ADR-044 Caddy origin `:8444`, Unmute voice loop + AoE board; external build context (`:160`).
- **ruvector-postgres** — mandatory memory store sidecar (ADR-015); compose block generated in `flake.nix:2200`, `db ruvector`, health-gated. `ruvector-mcp.cjs` fails closed, no sql.js fallback.
- **xr-runtime** — Godot 4 XR consumer, downstream of the box (referenced by role; not a supervised program here).

### Manifest gates + system-manifest catalogue

`GET /v1/system` (ADR-039) serves the live view. `management-api/lib/system-manifest.js` holds a hand-authored `CATALOGUE` of 14 surfaces + ~35 modules; the *catalogue* is documentation-as-data but the *state* of each entry is introspected from the parsed `agentbox.toml` at request time (`stateOf`, `:232`), so state can never drift from the manifest even if the catalogue does. Each entry carries a `gate` (dotted toml path, section gates resolve via `.enabled`), a `service` (supervisor program / sidecar), and an honest `apply_class`. The five adapter slots are emitted as `core` layer with their resolved `impl` + `contract_version` (`:267`).

#### `[vault]` — the authored-corpus path authority (ADR-2028)

`[vault]` is a top-level manifest section and the **single** path authority for
the authored knowledge corpus: `root` (absolute vault root), `pages` (relative,
default `pages`), `format` (`obsidian` | `logseq-legacy`, read-tolerance only)
and `tui` (`rune` | `none`, ADR-2029). It is schema-validated
(`schema/agentbox.toml.schema.json`, `root` required).

`config/entrypoint-unified.sh` resolves it once — before any consumer runs, via
the hoisted `_ab_toml_val` reader — and exports `VAULT_ROOT`, `VAULT_PAGES`
(= `root/pages`), `VAULT_FORMAT` and `VAULT_TUI`. Supervised programs inherit
them from PID 1; tmux windows and interactive shells pick them up from the
Phase-8 runtime-env file (`/run/agentbox/runtime-env.sh`, sourced by
`/etc/profile.d` for bash and `conf.d` for fish). `ONTOLOGY_PAGES_DIR` is
derived from `VAULT_PAGES` and survives one release as an explicit override.

The section is catalogued as **two** entries, because its keys have genuinely
different apply classes and one entry claiming `boot` for both would tell an
operator that flipping `tui = "rune"` and restarting gets them the Rune TUI —
it does not (ADR-039 honesty rule, triggered by ADR-2020's review_trigger for a
new optional manifest block):

| Entry | Gate | Apply class | Why |
|---|---|---|---|
| `vault` | `vault.format` | `boot` | `root`/`pages`/`format` are read once by the entrypoint at container start |
| `vault-tui` | `vault.tui` | `rebuild` | `tui` decides the Nix package set (ADR-2029); `none` → `rune` needs `./agentbox.sh rebuild` |

`stateOf` treats a mode string of `off` **or** `none` as off, so the vanilla
default (`tui = "none"`) reports `vault-tui` as `off`, not `on`.
`buildSystemView` also emits a top-level `vault` block with the resolved
`root`/`pages`/`format`/`tui` plus the `VAULT_ROOT` this process actually
booted with, so `/v1/system` and the doctor can show drift between the manifest
and the running container.

Absent `[vault]` is **fail-loud, not fail-quiet**: the boot prints
`[vault] disabled — no [vault] in agentbox.toml`, the ontology PUSH-cache
refresh is skipped, and every corpus consumer (`ontology-local.js`,
`ontology-index-build.js`, the condensation scheduler and refresh, the
page-writing skills) disables itself with one clear line rather than indexing a
stale or empty tree. `scripts/ci/check-no-logseq-paths.sh` fails the build on
any re-introduced hard-coded corpus path outside `docs/archive/` and
`docs/adr/`.

### MCP projection (skills/mcp.json)

`skills/mcp.json` (v2.0.0) is a 30-server registry and the *source of truth*; `scripts/project-mcp-servers.mjs` is the projector that upserts entries into `.mcp.json` at boot. Three ownership classes (`x-agentbox-managed-by`): **projector** (9 servers — gate-evaluated against boot env, `x-agentbox-requires` presence-checked, `${VAR}` expanded, reconciled not appended — a server whose gate/requires now fail is *removed*); **bespoke** (3 — claude-flow, browser-gpu, perplexity — hand-written entrypoint blocks, never touched); **reference** (16 — skill-local or npx network-installer servers, documented but not auto-projected). This closes audit MCP-1/MCP-2 (the registry previously had no runtime consumer; codebase-memory was manifest-ON yet registered nowhere).

## Known divergences & open items

- **AoE :9095 token auth — landed (verified at `73540faa0`).** `flake.nix:1977` `[program:aoe-serve]` runs `aoe serve --auth token --behind-proxy` (N-05; surrounding rationale `flake.nix:1960-1973`): the daemon mints a shared-secret token at launch into `~/.config/agent-of-empires/serve.url` (not env-settable), the sole-ingress nip98-proxy (`config/nip98-proxy/proxy.mjs`) reads it and injects `Authorization: Bearer` on every AoE-upstream request, and the break-glass `config/nostr-gateway/gateway.cjs` reads the same file. `config/entrypoint-unified.sh` chmods the token dir 0700. Loopback is no longer the boundary: a co-resident process that never reads the token file cannot drive sessions even though `:9095` is loopback-reachable. The two other direct :9095 callers were also repointed: the session-seed reconciler (`scripts/aoe-seed-sessions.mjs`) and the tab0-bridge (`config/tab0-bridge/server.mjs`) both read the same token file and inject `Authorization: Bearer` — without this the boot reconcile and the voice/nostr common ingress would 401 on the flip. Residual: same-uid (devuser) processes can still read the token file — the token removes free loopback access but does not isolate same-user peers.
- **Adapter contract versions are stale placeholders** — pods/memory/events/orchestrator all `1.0.0` despite live churn; a breaking change would need a MAJOR bump that has not happened.
- **Static-schema stage is advisory** — `agentbox-config-validate.js` + `W0xx` warnings do not hard-fail the build for dead-policy warnings; only structural schema violations reject.
- **`code-server` binds `0.0.0.0:8080`** while every other surface binds `127.0.0.1` (`flake.nix:1910`, compose `agentboxPorts`). Verify this is intended before ratification.
- **GPU wrapper is CUDA-only by design** — no Nix-binary Vulkan/GLX presentation path; interactive 3D depends on the FHS gui-tools sidecar. Not a bug, but a hard capability boundary.
- **Legacy ADR-005 conflates the four validation stages** into "contract tests"; this document separates them because they live in different files and fire at different lifecycle points (see Current State).
- Setup wizard exits after saving (`system-manifest.js:47`); operations moved to the AoE cockpit — legacy docs describing pseudo-user isolation (`gemini-user` etc.) are dead paths.

## Invariants (must not silently change)

- Five adapter slots, three implementation classes, one contract per slot — no client-only or standalone-only durable-state feature (ADR-005, CLAUDE.md).
- Every adapter dispatch wrapped observability → privacy → JSON-LD, in that order (`index.js:131`).
- Orchestrator boot-probe failure is FATAL; other slots go `degraded` and swap their live impl to `off` (`server.js:1219`, `:1223`).
- Supervisord is PID 1 root; no agent-facing process runs as root after bootstrap.
- `:9095` (AoE `--auth token`, `flake.nix:1977`) is NEVER published to the LAN; the NIP-98 proxy `:9096` is the one identity-gated door (`flake.nix:2238`).
- GPU wrapping applies only when `gpu.backend == "local-cuda"`; `--suffix` (never `--prefix`) on `LD_LIBRARY_PATH`.
- Manifest state is always introspected from `agentbox.toml`, never hard-coded in the catalogue (`system-manifest.js:11`).
- Adding a gate means gating both the Nix package set and the supervisor block, plus a `system-manifest.js` catalogue entry with an honest apply-class.
- `[vault].root` is the only default corpus path; no consumer hard-codes one, and an absent `[vault]` disables consumers loudly rather than falling back to a literal (ADR-2028, `project/docs/VAULT-corpus-format.md` Invariant 3, gated by `scripts/ci/check-no-logseq-paths.sh`).

## Change process

This is a living document. On any change to the flake package set, supervisor blocks, adapter spine, GPU wrappers, or MCP registry: update this file in the same change, re-run `git rev-parse --short HEAD` into `verified_commit`, bump `version`, and re-verify every `file:line` citation still resolves. Legacy ADR-005/039/PRD-001 are cited as evidence only — when code and ADR disagree, the code wins and the divergence is recorded above.
