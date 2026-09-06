---
title: Agentbox Container Baseline
doc_id: AB-BASELINE
version: 0.3.2
status: draft-for-ratification
verified_commit: 
changelog:
  - "0.3.2 (2026-09-06): Remediation — 2026-09-05 section: ADR-2057/2061/2062/2063/2064/2065/2066/2068/2069/2070/2072 and proposed 2071/2073–2078, the ADR-2018 recall diagnosis, landed in 796d85fcf — re-verified at "
  - "0.3.1 (2026-09-05) — ADR-2063: agentbox-mcp hub waits for /run/agentbox/mcp-hub.json (no FATAL on the priority race) and the entrypoint nudges it after projection; aoe-profiles volume persists AoE session records across restarts; the seeder carries the seed model on native-agent overrides and reaps only its own clean, unreferenced, commit-free orphan worktrees (fail-closed on a pathless session)."
  - "0.3.0 (2026-09-05) — Phase 2 remediation sweep (ADR-2035/2036/2037/2039/2040, plus ADR-2055 routed from ab-learning-capabilities). The supervised-services table now cites `[program:<name>]` instead of line numbers, which had drifted by differing offsets. Corrected: opf-router is the privacy-filter redaction sidecar on 127.0.0.1:9092 (not an OpenAI facade on :8084); ruvector pins 0.3.0 (not 0.2.25); the CATALOGUE holds 60 entries = 13 surfaces + 47 modules (not 14 + ~35); skills/mcp.json holds 28 servers (not 30). Adapter boot probe rewritten: per-slot deadlines, quarantine-before-replace, four readiness states. Dispatch is two wrap layers; JSON-LD encoding is a gated route-level stage. The ADR-2008 and ADR-2032 qualifications are marked resolved with evidence."
  - "0.2.2 (2026-09-04) — ADR-2032: process-signalling tools (ruflo-daemon-gc, token-audit) identify daemons by argv boundaries against a launcher allowlist, fail closed on unknown launchers, and reject out-of-range registry PIDs; telemetry-data volume backs /var/lib/agentbox/telemetry; Codex ships as the full codex-package archive so codex-code-mode-host sits beside codex."
  - "0.2.1 (2026-09-02) — ADR-2028 amendment: `[vault].working` (second vault root, exported as VAULT_WORKING_ROOT/VAULT_WORKING_PAGES) and `[vault].transcripts` (podcast transcript store outside both vaults, VAULT_TRANSCRIPTS) for the sibling-vault corpus layout of jjohare/visionGraph; podcast-knowledge-ingest reads only these."
  - "0.2.0 (2026-09-02) — ADR-2028/2029: [vault] manifest section is the single corpus path authority (entrypoint exports VAULT_ROOT/VAULT_PAGES/VAULT_FORMAT/VAULT_TUI; system-manifest reports the resolved vault as two entries, vault=boot and vault-tui=rebuild); tmux window 9 \"Notes\" row added."
  - "0.1.1 (2026-08-31) — correct AoE :9095 to --auth token (live at 73540faa0, was mis-stated as --auth none/staged); boot-probe non-orchestrator failure sets health 'degraded' (impl→off), not 'off'."
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

`ruvector` is always in the package set (`ruvectorPkg` in `flake.nix`), pinned as an exact-semver Nix npm closure (`ruvector-0.3.0`, `lib/npm-cli.nix`); everything else is gated. Node is `nodejs_22` throughout. (ADR-2039: the version was `0.2.25` when this paragraph was written; the `nix-prefetch-url` comment immediately above the pin still names the old tarball.)

### Supervised services (real `[program:*]` blocks in flake.nix)

Supervisord runs as PID 1 root; every long-running program drops to `user=devuser`. Enumerated from the generated supervisor text:

| Program | Role | Port (bind) |
|---|---|---|
| `management-api` | Fastify control plane; `AGENTBOX_REQUIRED_FOR_READINESS` | `$MANAGEMENT_API_PORT` (4000) |
| `bootstrap` / `bootstrap-seal` | boot reconcile + one-shot readiness seal writing `/run/agentbox/bootstrap.done` | — |
| `aoe-serve` | Agent-of-Empires interaction plane, `--auth token --behind-proxy` | `127.0.0.1:9095` (never published) |
| `nip98-proxy` | sole NIP-98 ingress to `:9095`, multi-upstream `/mgmt/*` router | `:9096` (LAN-published) |
| `tab0-bridge` | voice/nostr meta-controller for tmux window 0 | `:8971` |
| `tmux-autostart` | primary operator terminal surface; window 0 is the tab0-bridge target, window 9 **"Notes"** is the vault TUI | — |
| └ window 9 "Notes" | Rune markdown TUI opened at `$VAULT_ROOT` when `[vault].tui = "rune"` and the binary is present; otherwise prints the same rebuild notice the Sessions window uses (ADR-2029) | — |
| `solid-pod` | solid-pod-rs sovereign storage, NIP-98 | `127.0.0.1:8484` |
| `https-bridge` | pod HTTPS bridge | — |
| `nostr-relay` | sovereign relay | `7777` (gated expose) |
| `nostr-gateway` | nostr gateway | — |
| `opf-router` | privacy-filter redaction sidecar (legacy ADR-008), gate `[privacy_filter]` | `127.0.0.1:9092` |
| `ruvector-aggregate-sweep` / `ruvector-pattern-distill` | memory sweep + distil loops | — |
| `ontology-condense-scheduler` | ontology condensation | — |
| `dream-engine` | ADR-052 nightly repo evolution (boot-class gate) | — |
| `jupyter-lab` | notebook surface (gated) | `127.0.0.1:8888` |
| `code-server` | web VS Code (gated) | `0.0.0.0:8080` |
| `comfyui-builtin` | image workflows (gated) | `127.0.0.1:8188` |
| `qgis-mcp` / `blender-mcp` / `imagemagick-mcp` | GPU/media MCP servers (gated) | `9877`, `9876`, — |
| `xvnc` / `x11vnc` / `wayvnc` / `xorg-nvidia` / `hyprland` / `i3wm` / `xwayland-session` | desktop stack (gated `desktop.enabled`) | `127.0.0.1:5901` |
| `tailscaled` / `tailscale-up` | mesh networking (gated) | — |
| `podcast-cron` / `forum-backup-cron` | scheduled jobs | — |

Readiness (`server.js:508`) requires `bootstrap.done`, `adapters:healthy`, and `paths:accessible`; `bootstrap-seal` is a one-shot at `priority=99` — if it times out `/ready` stays 503.

### Adapter spine — five slots, three classes, four validation stages

The durable-state spine is the five-slot adapter pattern (legacy ADR-005): slots `beads, pods, memory, events, orchestrator` (`adapters/index.js:17`, `system-manifest.js:267`). Each resolves at boot to one of three implementation classes — a local class (`local-*`/`embedded-*`), a federated class (`external`/`external-pg`/`stdio-bridge`), or `off`. Every dispatch is wrapped observability → privacy redaction (`instrumentAdapter`, `index.js:131`; `wrapDispatch`, `observability/metrics.js:125`). JSON-LD encoding is **not** a third wrap layer: it is a per-surface, manifest-gated stage invoked by the owning route, whose ordering is enforced by the privacy marker rather than by position (ADR-2036).

The reviewer flag stands: ADR-005 conflates four *separate* validation stages that live in different code and fire at different times. The actual policy:

1. **Static schema validation** — `schema/agentbox.toml.schema.json` + `scripts/agentbox-config-validate.js` reject a malformed manifest before build; ADR-005 `W0xx` warnings flag dead policy (e.g. `W041`, ADR-005:128). Stage output: a valid gate set. Runs at edit/build time.
2. **Boot probe** — `connectAdapters` (`adapters/lifecycle.js:217`, wired from `server.js:1241-1242`) connects each slot under **its own deadline**, not one aggregate budget (`DEFAULT_CONNECT_TIMEOUT_MS = 10000`, `lifecycle.js:70`; overridable per slot via `[adapters] connect_timeout_ms`). A timeout is a connect failure identical in consequence to a rejection. A failed adapter is **quarantined before** any replacement is attempted (`lifecycle.js:274`) — every dispatch method becomes an `AdapterQuarantined` thrower (503), so a late-settling connect can never become live. Each slot ends in one of four states — `off | ready | disabled | unavailable` (`lifecycle.js:55-66`) — collapsed to the legacy `healthy | degraded | off` vocabulary by `toLegacyHealth` (`:324`) for `/health`, with the full record on `app.adapterReadiness` (`server.js:1257`). A replacement that cannot be built leaves the slot quarantined and `unavailable` rather than leaving the broken original wired (`:292-299`). **`orchestrator` is the sole fail-closed slot** (`FAIL_CLOSED_SLOTS`, `:73`) and is fatal on rejection, timeout and quarantine alike (`:276-281`, `:303-309`). Runs once per boot. (ADR-2035.)
3. **Conformance** — one contract suite per concern under `tests/contract/*.contract.spec.js` (memory, pods, events, beads, orchestrator, …) asserts all three implementation classes behave identically. Runs in CI, not at boot.
4. **SLO** — per-slot p95 latency / throughput / error-rate targets (ADR-005:157-161) surfaced as the `agentbox_adapter_health` gauge ∈ {0,1,2} and `agentbox_adapter_dispatch_total` / `_duration_seconds` on `/metrics`. `agentbox.sh health` exits non-zero when any slot in the `/health` payload's `adapters` map is neither `healthy` nor `off`, or when `degraded_count > 0` (`agentbox.sh:1129-1140`, `:1179`). It reads that payload, not the Prometheus gauge (ADR-2037). Runs continuously.

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

`GET /v1/system` (ADR-039) serves the live view. `management-api/lib/system-manifest.js` holds a hand-authored `CATALOGUE` of 60 entries — 13 surfaces + 47 modules (ADR-2039); the *catalogue* is documentation-as-data but the *state* of each entry is introspected from the parsed `agentbox.toml` at request time (`stateOf`, `:232`), so state can never drift from the manifest even if the catalogue does. Each entry carries a `gate` (dotted toml path, section gates resolve via `.enabled`), a `service` (supervisor program / sidecar), and an honest `apply_class`. The five adapter slots are emitted as `core` layer with their resolved `impl` + `contract_version` (`:267`).

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

`skills/mcp.json` (v2.0.0) is a 28-server registry (ADR-2039) and the *source of truth*; `scripts/project-mcp-servers.mjs` is the projector that upserts entries into `.mcp.json` at boot. Three ownership classes (`x-agentbox-managed-by`): **projector** (9 servers — gate-evaluated against boot env, `x-agentbox-requires` presence-checked, `${VAR}` expanded, reconciled not appended — a server whose gate/requires now fail is *removed*); **bespoke** (3 — claude-flow, browser-gpu, perplexity — hand-written entrypoint blocks, never touched); **reference** (16 — skill-local or npx network-installer servers, documented but not auto-projected). This closes audit MCP-1/MCP-2 (the registry previously had no runtime consumer; codebase-memory was manifest-ON yet registered nowhere).

### Resource envelope and resident overhead paths (ADR-2034)

`agentbox.toml [resources]` is the container envelope: `flake.nix`
`agentboxResources` emits `deploy` limits/reservations (incl. the nvidia device
reservation), `cpuset`, `cpu_shares`, `pids_limit` and `shm_size` into the
generated compose, and `[resources.tmpfs]` sizes `/run`, `/tmp`, `~/.npm`,
`~/.cache`. `docker-compose.override.yml` carries no limits. Three resident
programs replace per-session/per-call overhead: `[program:agentbox-mcp-hub]`
(`agentbox-mcp hub`, loopback `:9720`, serves the `[resources.mcp_hub].servers`
list once for every session; `agentbox-manifest mcp-hub-project` rewrites those
`.mcp.json` entries to `type: http` at the end of the boot MCP sequence and keeps
the stdio definitions in `$WORKSPACE/.mcp-hub-servers.json`),
`[program:agentbox-hook-drain]` (folds the `/run/agentbox/hooks` spools written
by `agentbox-hook event` — the shim the boot `agentbox-hook reconcile` installs
into every project's `.claude/settings.json` in place of the ruflo/aqe CLI hooks
— into `/var/lib/agentbox/events/hooks`), and `[program:teammate-gc]` (idle
agent-team teammates, ADR-2032 identity rules). Background programs run under
`nice -n [resources.services].nice`. Catalogue: `resources-envelope` (boot),
`mcp-hub`, `hook-shim`, `teammate-gc` (rebuild).

## Known divergences & open items

- **AoE :9095 token auth — landed (verified at `73540faa0`).** `flake.nix:1977` `[program:aoe-serve]` runs `aoe serve --auth token --behind-proxy` (N-05; surrounding rationale `flake.nix:1960-1973`): the daemon mints a shared-secret token at launch into `~/.config/agent-of-empires/serve.url` (not env-settable), the sole-ingress nip98-proxy (`config/nip98-proxy/proxy.mjs`) reads it and injects `Authorization: Bearer` on every AoE-upstream request, and the break-glass `config/nostr-gateway/gateway.cjs` reads the same file. `config/entrypoint-unified.sh` chmods the token dir 0700. Loopback is no longer the boundary: a co-resident process that never reads the token file cannot drive sessions even though `:9095` is loopback-reachable. The two other direct :9095 callers were also repointed: the session-seed reconciler (`scripts/aoe-seed-sessions.mjs`) and the tab0-bridge (`config/tab0-bridge/server.mjs`) both read the same token file and inject `Authorization: Bearer` — without this the boot reconcile and the voice/nostr common ingress would 401 on the flip. Residual: same-uid (devuser) processes can still read the token file — the token removes free loopback access but does not isolate same-user peers.
- **Adapter contract versions are stale placeholders** — pods/memory/events/orchestrator all `1.0.0` despite live churn; a breaking change would need a MAJOR bump that has not happened. Raised by the estate review 2026-09-05; a version field that looks meaningful and is not must either be bumped under a stated policy or recorded as intentionally frozen. Open.
- **Static-schema stage is advisory** — `agentbox-config-validate.js` + `W0xx` warnings do not hard-fail the build for dead-policy warnings; only structural schema violations reject.
- **Resolved — ADR-2040 (2026-09-05).** `code-server` bound `0.0.0.0:8080` with `--auth none`, and `jupyter-lab` bound `0.0.0.0:8888` with an empty `--IdentityProvider.token=`. A loopback *publish* only constrains host→container, so both were reachable unauthenticated by every peer on `visionclaw_network`. Both now authenticate with a credential minted at boot; the listener-side CI gate remains open work.
- **GPU wrapper is CUDA-only by design** — no Nix-binary Vulkan/GLX presentation path; interactive 3D depends on the FHS gui-tools sidecar. Not a bug, but a hard capability boundary.
- **Legacy ADR-005 conflates the four validation stages** into "contract tests"; this document separates them because they live in different files and fire at different lifecycle points (see Current State). ADR-2005's dispatch-ordering claim is superseded by ADR-2036.
- Setup wizard exits after saving (`system-manifest.js:47`); operations moved to the AoE cockpit — legacy docs describing pseudo-user isolation (`gemini-user` etc.) are dead paths.

## Invariants (must not silently change)

- Five adapter slots, three implementation classes, one contract per slot — no client-only or standalone-only durable-state feature (ADR-005, CLAUDE.md).
- Every adapter dispatch wrapped observability → privacy redaction, in that order (`index.js:131`, `observability/metrics.js:125`). JSON-LD encoding is a per-surface gated stage invoked by the owning route, and its ordering is enforced by the privacy marker via `assertPrivacyFilterApplied` — not by wrap position (ADR-2036).
- Orchestrator connect failure is FATAL — on rejection, timeout and quarantine alike; other slots are quarantined and then swapped to the `off` impl, or left `unavailable` if that replacement cannot be built (`adapters/lifecycle.js:73`, `:274`, `:276-281`, `:292-299`) (ADR-2035).
- Supervisord is PID 1 root; no agent-facing process runs as root after bootstrap.
- `:9095` (AoE `--auth token`, `flake.nix:1977`) is NEVER published to the LAN; the NIP-98 proxy `:9096` is the one identity-gated door (`flake.nix:2238`).
- GPU wrapping applies only when `gpu.backend == "local-cuda"`; `--suffix` (never `--prefix`) on `LD_LIBRARY_PATH`.
- Manifest state is always introspected from `agentbox.toml`, never hard-coded in the catalogue (`system-manifest.js:11`).
- Adding a gate means gating both the Nix package set and the supervisor block, plus a `system-manifest.js` catalogue entry with an honest apply-class.
- A supervised program that depends on a file the bootstrap program writes later waits for it with a bounded timeout rather than failing into FATAL (ADR-2063, `services/agentbox-mcp/src/hub/mod.rs` `wait_for_config`); AoE session records live on the `aoe-profiles` volume, and the seeder's orphan reaper removes only clean, unreferenced, commit-free worktrees whose basename is exactly a seeded slug, refusing to act when a managed session exposes no path (ADR-2063, `scripts/aoe-seed-sessions.mjs` `reapOrphanWorktrees`).
- Any tool that signals a process decides identity on argv elements against a known launcher allowlist and fails closed; joined-string matching is prohibited (ADR-2032, `services/agentbox-ops/src/procs.rs:23`).
- Resource limits live only in `agentbox.toml [resources]` and the generated compose; `docker-compose.override.yml` never carries `deploy` limits or `shm_size` (ADR-2034).
- The MCP hub binds loopback only (`services/agentbox-mcp/src/hub/config.rs` `is_loopback_bind`, refused otherwise) and is never published; `[resources.mcp_hub].servers` never lists a server with per-session state (claude-flow, code-interpreter, aci-shell, codebase-memory, agentic-qe) (ADR-2034).
- No project settings file invokes a CLI (`ruflo`, `claude-flow`, `aqe`, `agentic-qe`, `npx …`) on a per-tool-call hook; the boot `agentbox-hook reconcile` rewrites any that appear (ADR-2034).
- `[vault].root` is the only default corpus path; no consumer hard-codes one, and an absent `[vault]` disables consumers loudly rather than falling back to a literal (ADR-2028, `project/docs/VAULT-corpus-format.md` Invariant 3, gated by `scripts/ci/check-no-logseq-paths.sh`).

## Change process

This is a living document. On any change to the flake package set, supervisor blocks, adapter spine, GPU wrappers, or MCP registry: update this file in the same change, re-run `git rev-parse --short HEAD` into `verified_commit`, bump `version`, and re-verify every `file:line` citation still resolves. Legacy ADR-005/039/PRD-001 are cited as evidence only — when code and ADR disagree, the code wins and the divergence is recorded above.

## Runtime boundary qualification — 2026-09-04

Profile isolation routes configuration under one OS user; it is not an OS access boundary. ADR-2007 is partial because the current wrapper host assertion is substring-based and accepts wrong-host fixtures. Exact endpoint validation remains required.

See the [estate review](../../../VisionFlow/docs/estate-review/runtime-egress-and-profiles.md) for isolated probes and current source scope. No live provider call, relay send or custody change is certified here.

## Configuration projection qualification — 2026-09-04

Desired manifest state, built image, projected target and loaded process configuration require separate receipts. **Resolved — ADR-2039 (2026-09-05).** Both defects are closed by the ADR-2008 closeout: an ownership ledger removes owned names that are no longer projector-managed (`scripts/project-mcp-servers.mjs:33-39`), and malformed input now exits non-zero with the previous target retained byte-for-byte (`:46-49`, exit codes `:71-74`). Original 2026-09-04 text: ADR-2008 is partial: the current-name reconciliation loop cannot remove deleted registry definitions and unreadable input leaves stale state with exit zero. ADR-2003 requires complete build identity beyond TOML; ADR-2031 remains staged pending its recorded Nix/boot acceptance. The [estate configuration review](../../../VisionFlow/docs/estate-review/configuration-projection.md) records isolated fixtures and remaining recovery requirements.

## Adapter acceptance qualification — 2026-09-04

**Resolved — ADR-2035 and ADR-2036 (2026-09-05).** The lifecycle half is closed: there is no aggregate timeout, so explicit failure and timeout no longer have different outcomes — each slot races its own deadline and both outcomes quarantine the adapter (`adapters/lifecycle.js:256`, `:274`); a replacement that fails leaves the slot `unavailable` rather than leaving the broken original wired (`:292-299`). The middleware half is closed by correction rather than by code: encoding IS a separate caller action, deliberately, and the doc's three-layer claim was the error (ADR-2036). Original 2026-09-04 text: ADR-2004/2005 are partial for broad lifecycle and middleware guarantees. Require per-method coverage, schema preservation and lifecycle fault receipts. The [estate dispatch review](../../../VisionFlow/docs/estate-review/adapter-dispatch.md) records actual isolated wrapper probes and source-only lifecycle findings.

## Vault compatibility and Notes qualification — 2026-09-04

ADR-2028 is partial for universal disablement: the no-vault resolver clears VAULT_PAGES but retains a legacy ONTOLOGY_PAGES_DIR override, which consumers prefer. The Notes script selects by binary presence, not VAULT_TUI, and can use a retained workspace binary or workspace-root fallback. ADR-2029 keeps its historical/staged evidence; usable editing and recovery need their own receipt. See the [estate vault review](../../../VisionFlow/docs/estate-review/authored-vault-transition.md#runtime-path-overrides-and-notes-launch).

## Process lifecycle qualification — 2026-09-04

**Resolved — ADR-2039 (2026-09-05).** Hermes Stop no longer uses PID existence: `daemon_stop_with` verifies the recorded `(pid, argv, starttime)` identity immediately before signalling (`services/agentbox-ops/src/hermes/mod.rs:575`) and again while polling for observed exit (`:596`), and reports delivery separately from confirmed exit (`:434-435`). Original 2026-09-04 text: ADR-2032 is partial for its all-signalling-tools rule: ruflo argv checks are implemented, while Hermes Stop uses PID existence only. Registry precedence, process-instance binding and observed shutdown remain distinct obligations. The [process review](../../../VisionFlow/docs/estate-review/process-lifecycle.md) records four passing native helper tests; no live signalling or recovery certification is implied.

## GPU scope and evidence qualification — 2026-09-04

ADR-2006's graphics review trigger has been reached: current wrappers include GLX/EGL/Vulkan defaults alongside CUDA library-path configuration. Its historical complete/live CUDA evidence does not establish current presentation or ABI behaviour. CLI wrapper operations and supervisor environment assignments need separate effective-state checks. The existing backend test skips without Nix and its source calls the former dispatch interface. [Source review and acceptance](../../../VisionFlow/docs/estate-review/rendered-state.md#gpu-packaging-and-runtime-boundary) keep compute, presentation and sidecar paths distinct.

## Remediation — 2026-09-05

One line per ADR that amended this document in the Phase 2 remediation pass.

- **ADR-2035** — Adapter connect uses a per-slot deadline and quarantines a failed adapter before
  replacing it. Rewrote §Adapter spine stage 2 and the orchestrator Invariant; closed the lifecycle
  half of "Adapter acceptance qualification — 2026-09-04".
- **ADR-2036** — The dispatch wrap is two layers; JSON-LD encoding is a gated surface that enforces
  its own ordering. Supersedes ADR-2005. Rewrote the dispatch sentence in §Adapter spine and the
  dispatch-order Invariant; closed the middleware half of the same qualification.
- **ADR-2037** — `agentbox.sh health` derives failure from the `adapters` map and `degraded_count`
  that `/health` actually emits, so its non-zero exit is reachable. Corrected §Adapter spine stage 4.
- **ADR-2039** — This document cites `[program:<name>]`, not line numbers. Stripped the stale line
  refs from the supervised-services table, corrected the `opf-router` row (privacy-filter redaction
  sidecar on `127.0.0.1:9092`, not an OpenAI façade on `:8084` — routed from ab-learning-capabilities
  ADR-2055), corrected the `ruvector` pin to `0.3.0`, the catalogue census to 13 surfaces + 47
  modules, and the MCP registry to 28 servers; marked the ADR-2008 and ADR-2032 qualifications
  resolved with evidence and appended re-verification sections to both records.
- **ADR-2040** — No supervised program offers an unauthenticated listener on a bridge-reachable
  interface. Replaced the `code-server` divergence bullet; the listener-side CI gate stays open.
- **ADR-2072** — The briefing workflow VisionClaw already called now has a server: `/v1/briefs`,
  `/v1/briefs/:id/execute` and `/v1/briefs/:id/debrief` in `management-api/routes/briefing.js`,
  writing through the pods and beads slots, minting via `lib/uris.js`, and gating the execute step
  through the same ADR-2041 action pipeline as `POST /v1/tasks`; staged until the next rebuild.
