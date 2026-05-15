# Agentbox Repo Notes

## Security Audit Sprint (2026-05-11)

A DreamLab ecosystem-wide security audit applied 7 fixes to agentbox.
See CHANGELOG.md `[Security Audit Sprint] - 2026-05-11` for the full
manifest. Key areas hardened: binary payload buffer sizing (P0-10),
NIP-98 structural validation (P0-11), command injection via exec()
(R2-P0-02), dangerous permission skipping (R2-P0-03), ComfyUI backend
wiring (P1-27), server-side payment enforcement (P1-28), and JSON-LD
input schema validation (P2-10).

This file documents the current repo architecture. It is not a generic Claude Code prompt file.

## Current State

Agentbox is in active development:

- build composition is driven by `agentbox.toml`
- the runtime is sovereign/profile-based
- tmux with fish shell provides the multi-tab terminal experience (MAD-style layout)
- profile isolation replaces Linux pseudo-user isolation
- **pluggable adapters** replace hardcoded durable-state services (see [ADR-005](docs/reference/adr/ADR-005-pluggable-adapter-architecture.md)): beads, pods, memory, events, orchestrator — each resolves to `local-*`, `external`, or `off`
- standalone-or-federated: `federation.mode = "standalone"` ships a complete product with local fallbacks; `federation.mode = "client"` federates with a host container mesh through adapter endpoints
- embedded RuVector is a per-session retrieval cache, not a durable source of truth
- **MCP memory is mandatory ruvector-postgres** ([ADR-015](docs/reference/adr/ADR-015-mcp-ruvector-mandate.md)): the `ruvector-mcp.cjs` server fails closed if PostgreSQL is unreachable — no silent sql.js fallback. The entrypoint generates `.mcp.json` at boot and auto-installs the `pg` module to the workspace bind mount.

Full product spec: [PRD-001](docs/reference/prd/PRD-001-capabilities-and-adapters.md). Adapter contract + SLOs + observability: [ADR-005](docs/reference/adr/ADR-005-pluggable-adapter-architecture.md).

## Canonical Runtime Files

- [`flake.nix`](flake.nix): image composition and generated supervisor text
- [`agentbox.toml`](agentbox.toml): feature gates and toolchains
- [`config/entrypoint-unified.sh`](config/entrypoint-unified.sh): runtime bootstrap
- [`scripts/skills-entrypoint.sh`](scripts/skills-entrypoint.sh): runtime dependency bootstrap
- [`scripts/sovereign-bootstrap.py`](scripts/sovereign-bootstrap.py): identity generation and pod scaffolding
- [`scripts/provision-agent-stacks.py`](scripts/provision-agent-stacks.py): stack/profile provisioning
- [`config/tmux-autostart.sh`](config/tmux-autostart.sh): tmux session launcher (MAD-style tabs)
- [`config/tmux.conf`](config/tmux.conf): tmux configuration (fish shell, dark theme)

## URI/URN Scheme

Grammar: `urn:agentbox:<kind>:[<scope>:]<local>` where scope is a hex pubkey.

18 kinds: `pod`, `envelope`, `credential`, `mandate`, `receipt`, `activity`, `event`, `mcp`, `memory`, `skill`, `adr`, `prd`, `ddd`, `thing`, `dataset`, `bead`, `agent`, `meta`.

Identity: `did:nostr:<hex-pubkey>` (shared with VisionClaw substrate).

Content addressing: `sha256-12-<12 hex chars>` (same convention both sides).

Minting: all URNs are minted via `management-api/lib/uris.js`. All durable identifiers MUST be minted through `uris.js`. Ad-hoc `format!()` or template-literal URNs are prohibited.

Resolvability: best-effort via `/v1/uri/<urn>` (307/404/410). Canonical ref: [ADR-013](docs/reference/adr/ADR-013-canonical-uri-grammar.md).

Parallel namespace: the host project's Rust substrate uses `urn:visionclaw:<kind>:<hex-pubkey>:<local>` (6 kinds: `concept`, `kg`, `bead`, `execution`, `group`) minted in `src/uri/`. Owner-scoped kinds use 64-char hex pubkey as scope (not bech32 npub). The BC20 anti-corruption layer maps between the two namespaces at the federation boundary.

## Important Rules For Changes

- Do not reintroduce Linux pseudo-user isolation as the primary model.
- Optional features must remain manifest-gated through `agentbox.toml`.
- If a service is optional, gate both:
  - its Nix package set
  - its supervisor/service block
- Prefer shared mounts plus profile-local configuration over per-user home directory divergence.
- **Adapter contract is non-negotiable.** Every durable-state integration goes through one of the five adapter slots (beads, pods, memory, events, orchestrator). Never hardcode a backend. Never ship a feature that only works in `client` mode or only in `standalone` mode — the contract test harness in `tests/contract/` must pass for all three implementation classes per slot.
- **Adapter middleware is cross-cutting.** Observability (ADR-005), the privacy filter (ADR-008), and the JSON-LD encoder (ADR-012) are the three middleware layers that wrap every adapter dispatch, in that order — privacy redaction completes before the encoder runs (DDD-004 §L08). New cross-cutting concerns follow the same shape: one hook point, one policy per slot, fail-closed/fail-open semantics explicit in the ADR.
- **Linked-Data interfaces are opt-in per surface.** PRD-006 / ADR-012 / DDD-004 add eleven JSON-LD federation surfaces wrapping the existing adapters. Default off. Per-surface gates under `[linked_data]` in `agentbox.toml`. Context documents are pinned at build time via `lib/linked-data-contexts.nix` and never fetched at runtime. Hand-authored docs (skill frontmatter, ADR/PRD/DDD frontmatter) use the LION subset; the linter enforces the five rules in CI.
- **Every emitted `@id` follows the canonical URI grammar.** ADR-013 defines `did:nostr:<pubkey>` for identity and `urn:agentbox:<kind>:[<scope>:]<local>` for everything else, all minted through `management-api/lib/uris.js`. Uniqueness is unconditional; resolvability is best-effort via the `/v1/uri/<urn>` route (307/404/410). Surfaces never invent ad-hoc IDs.
- **The viewer slot (S12) is one implementation among many.** PRD-006 §15 + the `[linked_data.viewer]` manifest section make linkedobjects/browser the default viewer at `/lo/*`. Adding panes is a one-line manifest operation (`extra_panes`); swapping viewers is a single config flag (`mode = "external"`). The bundle is AGPL-3.0; aggregation analysis matches the solid-pod-rs treatment in `docs/developer/licensing.md`. AGPL §13 compliance is enforced by the route handler emitting a `Source-Code` header on every `/lo/*` response.
- **The sovereign data stack is first-class.** `solid-pod-rs` (ADR-010), `nostr-rs-relay` + pod-inbox bridge (ADR-009), the sovereign identity layer, and the privacy filter (ADR-008) are the coherent substrate agentbox commits to. Changes that degrade one layer's invariants (DDD-003 I01-I12 especially) must be weighed across all four — they share a single identity (hex pubkey / did:nostr) and a single source of truth.
- **No host-project specifics in this repo.** Agentbox is its own standalone project at `github.com/DreamLab-AI/agentbox`. Integration with any specific host project lives in that project's docs, not here. Reference the host by role ("host project", "integrator", "external orchestrator") rather than by name.
- **Observability is built-in, not optional.** Every adapter dispatch emits a span, a log line, and metrics. Only the exporters are optional (OTLP endpoint can be empty).

## Shared Runtime Model

The intended runtime model (updated for commit `2341480c`):

- `HOME=/home/devuser` is the canonical home directory for devuser. The old `HOME=/workspace` value has been retired.
- The agent workspace lives at `/home/devuser/workspace` (bind-mounted from `./workspace` in the base compose, or a named volume in the override).
- Profile-local settings live under `/home/devuser/workspace/profiles/<stack>/`.
- All profiles see the same `/projects` (bind-mounted from `./projects`).
- All profiles get the same `/opt/agentbox/skills` tree (image-baked).
- Scripts must use `$HOME` (which is `/home/devuser`) or the `$WORKSPACE` env var (`/home/devuser/workspace`) for durability. Using the literal path `/workspace` will break because that bind target no longer exists.
- Supervisord runs as PID 1 root; all long-running supervised processes drop to devuser via per-program `user=devuser`. No agent-facing process runs as root after the one-shot bootstrap phase.

## Legacy Files

These exist for historical context or partial compatibility and should not be treated as the primary runtime path:

- `config/supervisord.conf`
- older docs that describe `devuser`, `gemini-user`, `openai-user`, `zai-user`, `deepseek-user`
- old keepalive-only runtime assumptions

## Browser Container (GPU-accelerated Chrome + chrome-devtools-mcp)

The `browsercontainer/` directory contains a standalone Docker service for headless Chrome automation. It is NOT a Nix-managed service — it runs as a separate compose file on the `visionclaw_network`.

### Docker layout

```
agentbox.sh browsercontainer up/down/rebuild/health/cdp/gpu/shell/logs
docker-compose.browsercontainer.yml  ← compose definition
browsercontainer/
  Dockerfile           ← Arch Linux, Chrome Beta 149+, socat, x11vnc
  launch-chromium.sh   ← Chrome flags (Vulkan/ANGLE, TREAT_AS_SECURE)
  supervisord.conf     ← 5 services: xvfb, x11vnc, chromium, cdp-proxy, mcp-server
  server.js            ← MCP SSE bridge → chrome-devtools-mcp stdio
  healthcheck.sh       ← checks all 5 services
  cdp-diagnose.js      ← CDP diagnostic (navigate, evaluate, screenshot)
  package.json         ← node deps for server.js
```

### Port mapping

| Host port | Container port | Service |
|-----------|----------------|---------|
| 5903 | 5903 | VNC desktop (x11vnc) |
| 8931 | 8931 | MCP SSE bridge (chrome-devtools-mcp) |
| 9222 | 9223 (socat) → 9222 (Chrome) | CDP proxy |

The socat proxy on 9223 rebinds Chrome's localhost-only CDP so `/json/list` returns connectable `ws://` URLs from outside the container.

### Key details

- **Rendering**: WebGL via Three.js, NOT WebGPU. GPU provides Vulkan/ANGLE hardware acceleration.
- **TREAT_AS_SECURE**: Env var lists HTTP origins Chrome treats as secure contexts (for SharedArrayBuffer). Expanded to `--unsafely-treat-insecure-origin-as-secure=` flags per origin.
- **SharedArrayBuffer**: Requires `isSecureContext` (TREAT_AS_SECURE) + COOP/COEP headers from the target server.
- **Network**: `visionclaw_network` (external). Agents reach MCP at `http://browsercontainer:8931/sse`.
- **GPU**: Quadro RTX 6000 via UUID. Optional — healthcheck warns but doesn't fail without it.

## Docs To Keep In Sync

When architecture changes, update these together:

- [`README.md`](README.md)
- [`docs/user/quickstart.md`](docs/user/quickstart.md)
- [`CLAUDE.md`](CLAUDE.md)
- [`browsercontainer/README.md`](browsercontainer/README.md)
- relevant ADRs in `docs/reference/adr/`
