---
id: ADR-042
title: "Agent of Empires as the interaction plane: overlay-only adoption, supervised daemon, manifest gate"
status: proposed
date: 2026-08-04
type: architecture
author: Dr John O'Hare
supersedes: [ADR-025]
depends_on: [ADR-005, ADR-013, ADR-039]
related: [PRD-013, PRD-021, ADR-017, ADR-028, ADR-041, ADR-043, ADR-044, DDD-019]
review_trigger: >-
  upstream agent-of-empires ships a breaking change to the /api/sessions REST shape or the
  SESSION_PREFIX / tmux naming (re-verify the coexistence and voice-repoint seams); the AoE
  plugin runtime (aoe-plugin-api) leaves beta and sovereign-panel absorption becomes tractable
  (the deferred follow-up in D7 becomes a live ADR); a native did:nostr TokenSource inside AoE
  auth.rs is contemplated again (re-open the rejected alternative and weigh the rebase treadmill);
  the npmDepsHash-pinned web build drifts on a pin bump (WS1 refresh); or a per-activity harness
  is added that AoE cannot cover natively or via env_allowlist / custom_agents.
"@context": https://schema.org
"@type": TechArticle
---

# ADR-042 — Agent of Empires as the Interaction Plane: Overlay-Only Adoption

**Status:** Proposed
**Date:** 2026-08-04
**Repo:** DreamLab-AI/agentbox
**Supersedes:** [ADR-025 — Multi-Harness tmux Architecture](ADR-025-multi-harness-tmux-architecture.md) (the MAD-style 15-window layout and its bespoke `harness/<name>` worktree scheme; ADR-025's dual-path thesis — direct harness vs headless consultant — is retained, see D7)
**Provenance:** [DreamLab-AI/agentbox-of-empires](https://github.com/DreamLab-AI/agentbox-of-empires) — a clean mirror of upstream agent-of-empires v1.13.2 (HEAD `d615b8c8`, 2026-08-04; MIT; crane Nix flake; ~5,700 tests). A seven-lead compatibility investigation (`mesh-aoeCompat.md`, `mesh-tmuxHarness.md`) established that AoE's session-manager surface subsumes agentbox's interactive harness plane with **zero `src/` patches**. This ADR records the adoption and the overlay-only contract; the sovereign-identity binding it enables is [ADR-043](ADR-043-session-identity-binding.md); the voice repoint is [ADR-044](ADR-044-voice-plane-aoe-repoint.md); the sprint that lands all three is [PRD-021](../prd/PRD-021-interaction-surface-consolidation.md).

## Context

ADR-025 gave each AI coding harness a dedicated tmux window with direct filesystem access, replacing the Claude-Code-as-relay pattern. That decision was correct and its thesis holds; what it left behind is a **hand-rolled session manager written in shell**. `config/tmux-autostart.sh` builds one detached `agentbox` tmux session with 15 unconditional windows, primes each harness pane with `send-keys` profile exports and a `Run: <cli>` hint (the CLI is never auto-launched — the operator types it), and provisions `harness/<name>` git worktrees for the file-editing harnesses (`config/tmux-autostart.sh:400-427`, verified: `antigravity deepseek ollama` on branches `harness/<name>` under `WORKTREE_BASE`; Perplexity excluded as research-only). Profile isolation — `HOME` **and** `CLAUDE_CONFIG_DIR` both pointed at `profiles/<name>` so a redirected Claude binary reads that profile's runtime-written `settings.local.json` and never the global Anthropic key — is the load-bearing invariant (`config/tmux-autostart.sh:170-174`).

Three problems compound:

1. **No lifecycle, no observability.** The tmux plane has no session record, no status FSM, no attach/detach API, no diff view. Status is inferred by eye. The live container has already drifted from the committed spec — windows 1–3 were hand-repurposed into a voice-bridge shell and two ad-hoc Claude Code sessions (`mesh-tmuxHarness.md §1`), which is exactly the informal multi-session sprawl a session manager exists to formalise.
2. **The manager is unmaintained shell.** The `harness-merge` helper, the worktree plumbing, and the runtime key-injection all live in one ~460-line script (`config/tmux-autostart.sh:400-463`); every new harness is more shell.
3. **A mature session manager already exists in the ecosystem.** agent-of-empires is a Rust TUI + `aoe serve` web dashboard whose entire job is session lifecycle, per-session git worktrees + optional sandbox, live terminal/diff/status views, an ACP structured-view channel, and a REST/WS API — and it is already forked into the DreamLab org as a clean mirror.

The investigation's headline verdict: *rebuild agentbox's interaction plane **around** AoE as a config + reverse-proxy + (future) plugin overlay, not a source fork* (`mesh-aoeCompat.md` headline). This ADR adopts that verdict.

## Decision

Adopt agent-of-empires v1.13.2 as **the** interaction plane, integrated **overlay-only**, run as a **supervised, manifest-gated daemon**. Five decisions (D1–D3, D6–D7 of the sprint brief) are recorded here; the identity binding (D4) is [ADR-043](ADR-043-session-identity-binding.md) and the voice repoint (D5) is [ADR-044](ADR-044-voice-plane-aoe-repoint.md).

### D1 — AoE is the canonical interaction plane; the MAD tmux layout is superseded in place

The `aoe` TUI and the `aoe serve` web dashboard become the canonical way interactive agent sessions are created, monitored, attached, and reviewed. AoE natively owns session lifecycle, per-session git worktrees, live terminals, diffs, and a status FSM (`mesh-aoeCompat.md` capability "Per-session git worktree + sandbox", "aoe serve web dashboard + REST/WS", `src/server/mod.rs:1655-1847`). The ADR-025 layout is **superseded in place** — a one-shot, git-tracked upgrade, no parallel switchover:

| Region | ADR-025 (superseded) | ADR-042 |
|---|---|---|
| Tabs 8–14 (harness plane) | 7 primed-but-idle profile-isolated CLI panes, one worktree each | AoE-managed sessions (D6); AoE owns the profile-env injection and worktree creation |
| Window 4 (Logs), Window 7 (Git) | `supervisorctl tail` split; `git status` merge view | absorbed by the AoE dashboard live feed + per-session diff view (`mesh-tmuxHarness.md §7-8`) |
| Window 5 (System), Window 6 (VNC) | `systemscape` + `btm`; VNC connection info | **retained** as plain agentbox tmux windows (not agent sessions) |
| Windows 0–3 (operator-mutated) | ad-hoc, diverged from spec | formalised into named AoE sessions; the tab-0 coordinator stays special (runs in terminal view — see [ADR-044](ADR-044-voice-plane-aoe-repoint.md)) |

AoE namespaces every session under `SESSION_PREFIX` (`aoe_` release / `aoe_dev_` debug) as separate top-level tmux sessions `aoe_<title>_<id8>` (`src/tmux/mod.rs:188`, `src/tmux/session.rs:316`); its sweep/killall only touches `aoe_`-prefixed names (`src/tmux/mod.rs:302,662,704`). The `agentbox` session and any AoE sessions therefore coexist on one tmux server with **no collision** — the superseded layout can be retired window-by-window without a flag day.

### D2 — Overlay-only integration; zero `src/` patches; pinned flake input

AoE enters as a **pinned Nix flake input**, not a vendored or patched tree:

```nix
aoe.url = "github:DreamLab-AI/agentbox-of-empires/d615b8c8";  # or the v1.13.2 tag
# image package set pulls: inputs.aoe.packages.${system}.aoe-with-web
```

We consume the `aoe-with-web` package (feature `serve` = axum + `rust-embed`-baked dashboard, the web frontend built by a separate `buildNpmPackage` with a pinned `npmDepsHash` fed through `AOE_WEB_DIST`; `mesh-aoeCompat.md` Seam 1, capability "Nix crane build w/ web"). AoE's `crane` + `flake-parts` enter only as transitive inputs of the AoE flake; agentbox's existing `flake-utils` + `rust-overlay` + `nix2container` outputs are not restructured.

**All** integration — the supervisor block, the NIP-98 reverse proxy, the seeded `config.toml`/profiles, the session-create shim, and any future plugins — lives in the agentbox repo, **outside the crate**. The fork stays a clean mirror: `git rev-list --count HEAD` = 2010 commits, all authored by upstream contributors, and a grep across every commit for `agentbox|dreamlab|nostr|nip-98|did:nostr|visionclaw|sovereign` returns **zero** hits (`mesh-aoeCompat.md §"Fork status"`). Current carried patch surface is nil, and upstream is hot (multiple PRs/day, PR numbers in the #32xx range on the HEAD day). The rule follows directly: **any `src/` patch flips a near-zero pin-bump into a continuous rebase treadmill against a very active upstream and is prohibited.** Upstream tracking is a periodic pin bump; the only recurring cost is refreshing `npmDepsHash` if `web/package-lock.json` moves past the pin (frozen by the commit pin until then).

Native NIP-98 / did:nostr inside AoE's `src/server/auth.rs` is explicitly **rejected** (see Alternatives). The pluggable `TokenSource` enum at `auth.rs:465` is noted as the hook point *if ever revisited*, but the sovereign identity story rides D4's reverse proxy ([ADR-043](ADR-043-session-identity-binding.md)) precisely so that `src/` stays untouched.

### D3 — Supervised daemon + `[interaction_plane]` manifest gate + ADR-039 apply classes

A new flake-generated, manifest-gated supervisord program runs the Nix-built binary and drops to `user=devuser`, following the existing gated-supervisor-block pattern exactly (`mesh-aoeCompat.md` Seam 7):

```
aoe serve --auth none --behind-proxy --host 127.0.0.1 --port 9095
```

- **`--port 9095`** is chosen because AoE's default `8080` (`src/cli/serve.rs:40`) **collides with code-server** (live probe: `:8080 → 302 ?folder=/home/devuser/workspace`, node pid 570), and `:7777` (nostr relay) and other sovereign ports are live (`mesh-aoeCompat.md` Seam 7, risks). The daemon binds loopback only.
- **`--auth none --behind-proxy`** is safe *only* because the sole ingress to `:9095` is the NIP-98-verifying reverse proxy of [ADR-043](ADR-043-session-identity-binding.md); `--behind-proxy` trusts `X-Forwarded-For` / `cf-connecting-ip` and permits reduced auth (`src/cli/serve.rs:250-256`, `src/server/auth.rs:36`). The proxy-is-sole-ingress invariant is owned by ADR-043 and enforced by the loopback bind.

A new `[interaction_plane]` table in `agentbox.toml` gates the plane:

| Key | Meaning |
|---|---|
| `enabled` | master gate for the AoE daemon + dashboard |
| `port` | serve port (default `9095`) |
| `dashboard` | `on`/`off` for the web dashboard surface |
| `session_seeds` | declarative session list that replaces the harness-window block of `tmux-autostart.sh` (the D6 coverage matrix, seeded into `config.toml`/profiles) |
| `proxy_auth` | ingress auth scheme (`"nip98"`; consumed by ADR-043's proxy) |

Per ADR-039, the gate carries honest `system-manifest.js` catalogue entries with hand-assigned apply classes: the **daemon program and its config are apply-class `boot`** (the entrypoint reconciles the supervisor block and seeds per boot; flipping `enabled`/`session_seeds`/`port` takes effect on the next restart), and the **AoE binary itself is apply-class `rebuild`** (it is a Nix-baked package — changing the pin or pulling `aoe-with-web` in or out is an image recomposition, gate both the package set and the supervisor block). The catalogue entry joins the ADR-039 "docs to keep in sync" honesty burden: a gate with no catalogue entry (or vice versa) is the drift a review trigger names.

### D6 — Agent coverage: tabs → AoE sessions (native / custom_agents / env_allowlist / retired)

The seven interactive harness tabs map onto AoE sessions **config-only, no code** (`mesh-tmuxHarness.md §3, §8`; `mesh-aoeCompat.md` Seam 3). AoE's agent catalogue is wider than its README markets: **16 agents** in the `AGENTS` array (`src/agents.rs:689`) including `claude`, `codex`, `gemini`, **`antigravity`**, `qwen`, and `kimi`; the ACP structured-view registry keys `claude / claude-code / opencode / gemini / codex / vibe / pi / omp / kimi` (`src/acp/agent_registry.rs`), with three adapters bundled as pinned npm (`claude-agent-acp`, `codex-acp`, `pi-acp`; `src/acp/adapters.rs:35`). AoE also bundles **`aoe-agent`** (`acp-worker/aoe-agent/`), its own TypeScript ACP server wrapping Vercel AI SDK 6 with `@ai-sdk/{anthropic,google,openai,openai-compatible}` — a sanctioned multi-provider seam that can give the OpenAI-compatible harnesses (Z.AI, OpenRouter, DeepSeek, the gemma LAN endpoint) a *structured-view* session later without any `src/` patch; the sprint keeps the exact-CLI-UX mechanisms below and records `aoe-agent` as the structured-view upgrade path. The four coverage mechanisms are `custom_agents` (name→cmd, tmux view), `agent_command_override` (replace binary), `agent_acp_cmd` (make a custom agent structured-view-capable), `agent_detect_as` (borrow status heuristics), and per-`AgentSpec` `env_allowlist` (`docs/guides/configuration.md:124-143`, `docs/guides/agent-override.md`):

| Harness (ADR-025 tab) | Coverage mechanism | Notes |
|---|---|---|
| Claude Code (tab 0 + ad-hoc) | **native** `claude` | tab-0 coordinator stays special (terminal view, ADR-044) |
| Codex (tab 14, gpt-5.5) | **native** `codex` (codex-acp) | also model-routing execution host + consultant-codex — those stay headless (D7) |
| Gemini / Antigravity (tab 10) | **native** `gemini --acp` | worktree-isolated coding session |
| OpenRouter (tab 8) | **wrapper script via `agent_command_override`** | `claude` binary redirected via `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`; wrapper hard-fails if the redirect env is missing |
| ZAI GLM-5.2 (tab 9) | **wrapper script via `agent_command_override`** | same redirect shape; `api.z.ai/api/anthropic`; wrapper hard-fails if the redirect env is missing |
| DeepSeek / codewhale (tab 11) | **`custom_agents`** (tmux view) | optional `agent_detect_as = codex/claude` for status |
| Ollama-Gemma-LAN / nanocoder (tab 13) | **`custom_agents`** (tmux view) | LAN endpoint `http://192.168.2.48:8084/v1` |
| Perplexity (tab 12) | **RETIRED** | research shell, never a coding agent, no worktree |

**Top sprint risk, recorded here as a coverage constraint:** `ANTHROPIC_BASE_URL` is **not** in AoE's default env-forward set (default forwards only PATH/HOME/LANG/TERM + provider auth). The OpenRouter and ZAI sessions depend on that redirect — miss it and those sessions silently fall through to the direct Anthropic key, mis-billing (`mesh-aoeCompat.md` risks; `mesh-tmuxHarness.md §2`). **Mechanism (operator decision 2026-08-04): thin wrapper scripts registered via `agent_command_override` are primary** — each wrapper asserts the profile env, exports the redirect, hard-fails loudly if `ANTHROPIC_BASE_URL`/token are absent, then `exec claude` — converting the silent failure mode into an immediate visible one, structurally. Per-`AgentSpec` `env_allowlist` remains the documented alternative. Two further operator decisions ride this matrix: **AoE's per-session Docker sandboxing stays disabled** (profile isolation + the agentbox container boundary are the isolation model; AoE's `docker exec` sandbox would re-enter the documented DinD stale-mount footgun — revisit only for untrusted-code sessions with a host-built image), and **AoE runs on the shared default tmux socket** (no `AOE_TMUX_SOCKET`) so operator `tmux attach` and the voice bridge's pane captures keep working; the `aoe_` prefix sweep is the collision guard. The ADR-025 profile-isolation invariant is therefore **preserved verbatim** under AoE: `HOME` and `CLAUDE_CONFIG_DIR` both point at `profiles/<name>` for the redirected Claude binaries, and `settings.local.json` is runtime-written with the live key, never baked (`config/tmux-autostart.sh:170-174`).

Perplexity (tab 12) is retired outright: it was a `curl` research shell with no worktree (`config/tmux-autostart.sh` excludes it from the worktree loop; `mesh-tmuxHarness.md §3`). Research stays on `mcp__perplexity` + `consultant-perplexity` + the `/perplexity-research` skill — none of which are sessions. AoE's per-session worktrees supersede the `harness/<name>` worktree block, and `harness-merge` is reworked to target AoE worktree branches. One correctness fix rides this stream: the Antigravity model discrepancy (`gemini-2.5-flash` at the tab, `config/tmux-autostart.sh:259`, vs `gemini-3.5-flash` in `[consultants.antigravity]`, `agentbox.toml:810`) is aligned across both surfaces (`mesh-tmuxHarness.md §3 "Discrepancy flagged"`).

### D7 — What stays (non-goals)

The interaction plane is *interactive sessions only*. Everything below is out of scope and untouched by this ADR:

- **The headless consultant tier** (five `mcp/consultants/{codex,antigravity,zai,perplexity,deepseek}/server.js`, PRD-013 dual-path N06). These are MCP calls, not sessions; ADR-025's dual-path thesis survives its supersession — consultants remain the cost-effective small-query path alongside AoE (`mesh-tmuxHarness.md §4`).
- **Model routing** (`[model_routing]`, [ADR-041](ADR-041-model-routing-one-policy-many-projections.md)) — a boot-projected config/telemetry surface across 12 activities over two hosts (claude-code, codex), not a tab (`mesh-tmuxHarness.md §5`). Untouched.
- **The entire management-api sovereign surface** — pods, payments (HTTP 402), llm-marketplace, uri-resolver, `/v1/voice-intent`, kg-elevation, memory→pod, `/v1/system`, the `/lo` linked-data viewer, the setup dashboard, swagger. Overlap with the AoE dashboard is near-zero: AoE manages sessions/diffs/terminals/worktrees/MCP/profiles/plugins, management-api is a sovereign API (`mesh-aoeCompat.md` Seam 4).
- The events hash chain (ADR-039), telemetry `:9091`, relay `:7777`, solid-pod `:8484`, all MCP servers, and the VisionClaw-owned pages (voice console `:8444`, `visionclaw-server:4000`).

**Absorbing the sovereign panels *into* the AoE dashboard** via the AoE plugin API (`aoe-plugin-api`, MIT, `API_VERSION = 10` (`aoe-plugin-api/src/capability.rs:62`) — dockable `pane` slots, `RuntimeSpec` JSON-RPC stdio workers, `CommandContribution`/`StatusContribution`; host routes at `src/server/mod.rs:1794-1830`) is **roadmap, not sprint scope**. The plugin runtime is **beta** (some slots landed across upstream #2094/#2366/#2432; `mesh-aoeCompat.md` capability "Plugin API", risks; Tier-1 workers run `NoSandbox` — unsandboxed as the user, capability-gated only at the RPC boundary), and building RuntimeSpec workers + pane UIs for `/lo`, voice status, and the pod/memory/system panels is substantial. Two named roadmap items ride this seam: the sovereign-panel absorption, and an **event-mirror plugin worker** that streams AoE's SQLite session-event log (its operational store for ACP replay and live-WS catch-up — deeply wired, fork-invasive to replace) into RuVector/the hash-chained events adapter so the sovereign audit record stays complete. Both are recorded here as the follow-up ADR trigger, not a promise.

## Alternatives considered

- **Keep the MAD tmux layout (status quo, ADR-025).** Rejected. The layout has no session lifecycle, no status FSM, no attach/diff API, and is maintained as ~460 lines of shell whose live state has already diverged from the committed spec (`mesh-tmuxHarness.md §1`). Every new harness is more `send-keys`. AoE gives all of this for free as an adopted generic subdomain; retaining the shell manager is choosing to hand-write what upstream maintains with ~5,700 tests.
- **Fork-invasive native integration (patch AoE `src/`).** The strongest-looking option and the sharpest rejection. Native did:nostr/NIP-98 in `auth.rs` (hook point: the `TokenSource` enum at `auth.rs:465`) and agentbox-specific session semantics would be clean *code* — but the fork is a clean mirror of a very hot upstream (2010 commits, 0 DreamLab commits, multiple merges/day; `mesh-aoeCompat.md §"Fork status"`, Seam 8). Any carried `src/` patch converts a near-zero periodic pin bump into a perpetual rebase treadmill. Every seam AoE exposes — `custom_agents`, `agent_command_override`, `agent_acp_cmd`, `env_allowlist`, per-profile config, `--behind-proxy`/`--auth none`, the MIT plugin API, `POST /api/sessions/{id}/send` — was measured to cover the agentbox requirement *without* touching the crate (`mesh-aoeCompat.md` headline). Overlay-only is not a compromise; it is the lower-cost path that also delivers more.
- **Build our own TUI / session manager.** A bespoke control-plane SPA (of the kind already prototyped elsewhere in the org as a Foreman-style control surface) was considered as the front-of-house. Rejected as duplicated effort: it would re-implement session lifecycle, worktree isolation, terminal multiplexing, diff rendering, and an ACP structured-view channel that AoE already ships and tests. The sovereign value agentbox adds is *identity, provenance, and governance at the session boundary* (ADR-043), not a second session manager. Building UI is deferred to the plugin-absorption roadmap (D7), where our panels ride *inside* the adopted dashboard.
- **Per-window scripting improvements (incrementally harden `tmux-autostart.sh`).** Rejected as polishing the wrong artefact. Adding status heuristics, a JSON session record, and an attach API to the shell script re-derives, badly, the exact surface AoE already exposes over REST/WS (`src/server/mod.rs:1655-1847`). The maintenance would land on us; adopting AoE moves it upstream.

## Consequences

### Positive

- One canonical, tested, observable interaction plane. Session lifecycle, per-session worktrees + optional sandbox, live terminals, diffs, and a status FSM replace primed-but-idle `send-keys` panes and eyeball status (`mesh-tmuxHarness.md §8`; `src/server/mod.rs:1655-1847`).
- Net deletion of bespoke shell. The `harness/<name>` worktree block and the `harness-merge` helper (`config/tmux-autostart.sh:400-463`) collapse into AoE's built-in worktree model + seeded `config.toml`; new harnesses become config, not code.
- Overlay-only keeps the fork a clean mirror — near-zero carried patch surface, upstream tracking is a pin bump (`mesh-aoeCompat.md` Seam 8).
- The ADR-025 profile-isolation invariant and the dual-path consultant thesis both survive (D6, D7): supersession is of the *layout*, not the *principles*.
- A clean, HTTP-shaped injection seam (`POST /api/sessions/{id}/send`, `src/server/mod.rs:1693`) that works for ACP structured sessions where `tmux send-keys` cannot — the substrate the voice repoint of [ADR-044](ADR-044-voice-plane-aoe-repoint.md) builds on.

### Negative

- **Upstream tracking burden.** A very active upstream (multiple PRs/day) means the pin must be bumped deliberately, and each bump re-validates the `/api/sessions` REST shape, the `SESSION_PREFIX`/tmux naming, and the `env_allowlist` semantics the coverage matrix depends on. The npmDepsHash-pinned web build must be refreshed on any bump that moves `web/package-lock.json` (a broken Nix build if missed; `mesh-aoeCompat.md` risks). Overlay-only makes this cheap but not free.
- **The plugin runtime is beta.** The sovereign-panel absorption path (D7 roadmap) depends on `aoe-plugin-api` (`API_VERSION = 10`), whose slots landed across recent upstream PRs and are not yet a stable contract. Until it stabilises, the sovereign surfaces (`/lo`, voice status, pods/memory/system) live *beside* the AoE dashboard, not inside it — two front doors during the interim.
- **Coverage-mechanism fragility for redirected harnesses.** The `env_allowlist` / `agent_command_override` requirement for `ANTHROPIC_BASE_URL` is a silent-failure surface: a mis-seeded `AgentSpec` mis-bills to direct Anthropic with no error (`mesh-aoeCompat.md` risks). This is a manual-honesty burden the sprint must gate with a test, not a self-correcting one.
- The retirement of the Perplexity tab and the reworking of `harness-merge` are behaviour changes operators must be told about (docs-sync stream, PRD-021 WS7).

### Neutral

- No new adapter slot and no new URN kind are introduced by *this* ADR — session identifiers reuse the `activity` URN kind minted through `lib/uris.js`, specified in [ADR-043](ADR-043-session-identity-binding.md) (ADR-013 grammar). This ADR adds one gated supervisord program, one manifest table (`[interaction_plane]`), and one flake input.
- The `[interaction_plane]` catalogue entry joins the ADR-039 `system-manifest.js` honesty set; the state (`on`/`off`/`available`) is introspected from `agentbox.toml`, only the catalogue is hand-authored.
- Windows 5 (System) and 6 (VNC) remain plain tmux windows — the interaction plane deliberately does not swallow the operator dashboards, only the agent sessions (`mesh-tmuxHarness.md §7`).
- The AoE `aoe_`-prefixed tmux namespace and the `agentbox` session coexist on one server (`src/tmux/mod.rs:188,302`), so the supersession can be rolled out and, if needed, rolled back window-by-window without a flag day.

## Related decisions

- [ADR-025 — Multi-Harness tmux Architecture](ADR-025-multi-harness-tmux-architecture.md) — **superseded by this ADR** (layout + worktree scheme; dual-path thesis retained)
- [ADR-043 — Session Identity Binding](ADR-043-session-identity-binding.md) — the sovereign payload (D4): per-session did:nostr, URN, beads ledger, scoped namespaces, mandates, and the NIP-98 sole-ingress proxy
- [ADR-044 — Voice Plane AoE Repoint](ADR-044-voice-plane-aoe-repoint.md) — the voice bridge (D5) repointed onto `POST /api/sessions/{id}/send`
- [PRD-021 — Interaction-Surface Consolidation](../prd/PRD-021-interaction-surface-consolidation.md) — the sprint that lands D1–D7
- [DDD-019 — Interaction Plane Domain](../ddd/DDD-019-interaction-plane-domain.md) — the bounded context; AoE as an adopted generic subdomain behind an anti-corruption layer
- [PRD-013 — Multi-Harness tmux Architecture](../prd/PRD-013-multi-harness-tmux-architecture.md) — the requirements ADR-025 served
- [ADR-013 — Canonical URI Grammar](ADR-013-canonical-uri-grammar.md), [ADR-017 — Multi-Tenant did:nostr Pods](ADR-017-multi-tenant-did-nostr-pods.md), [ADR-028 — Per-User Agent Fabric](ADR-028-per-user-agent-fabric.md) — the identity fabric ADR-043 wires into session boundaries
- [ADR-039 — docBox Back-Ports](ADR-039-docbox-backported-surfaces.md) — the apply-class taxonomy and `system-manifest.js` catalogue this gate obeys
- [ADR-041 — Model Routing](ADR-041-model-routing-one-policy-many-projections.md) — the headless routing surface D7 leaves untouched
