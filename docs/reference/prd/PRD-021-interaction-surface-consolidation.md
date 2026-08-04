# PRD-021: Interaction-Surface Consolidation around Agent of Empires

**Status:** Proposed
**Date:** 2026-08-04
**Repo:** [github.com/DreamLab-AI/agentbox](https://github.com/DreamLab-AI/agentbox)
**Related:** PRD-013 (Multi-harness tmux architecture — **superseded in part**), PRD-012 (Setup dashboard — absorbed), PRD-006 (Linked-data interfaces — `/lo` viewer retained), PRD-014 (Embodied agent loop — voice-intent seam untouched), PRD-017 (Sovereign project tracking — kind-30840/30841 digests untouched), PRD-019 (Gap-close — identity fabric this sprint activates), PRD-007 (Multi-tenant federation), PRD-001 (Capabilities and adapters), ADR-042 (Agent of Empires interaction plane — this PRD's adoption record), ADR-043 (Session identity binding), ADR-044 (Voice-plane AoE repoint), ADR-025 (Multi-harness tmux — **superseded**), ADR-013 (Canonical URI grammar), ADR-017 (Multi-tenant did:nostr pods), ADR-028 (Per-user agent fabric), ADR-039 (Apply-class catalogue), ADR-041 (Model routing — untouched), ADR-005 (Pluggable adapters), ADR-008 (Privacy filter), ADR-012 (JSON-LD grammar), DDD-019 (Interaction-plane domain), DDD-010 (Multi-harness coordination — superseded parts), DDD-003 (Sovereign messaging), DDD-016 (Memory learning)

## TL;DR for newcomers

*Skip if you already know what Agent of Empires is and why agentbox is adopting it as the interaction plane.*

Today an agentbox operator drives interactive agents through a hand-rolled tmux layout: one session named `agentbox` with fifteen numbered windows (`config/tmux-autostart.sh`), where tab 0 is the primary Claude coordinator and tabs 8–14 are per-provider coding harnesses — OpenRouter, Z.AI, Antigravity/Gemini, DeepSeek, Perplexity, Ollama, Codex. Each harness window `send-keys` a block of profile-isolation exports and then sits at a fish prompt waiting for the operator to type the CLI by hand (`tmux-autostart.sh:170-174`, verified live). There is no session lifecycle, no status FSM, no diff view, no web console — the operator infers a harness's state from pane text, merges its worktree with a bespoke `harness-merge` shell function, and injects remote/voice commands by literally `tmux send-keys -t agentbox:0` (`config/tab0-bridge/server.mjs:92-99`). The layout has already drifted from its own spec: windows 1–3 are operator-repurposed and three concurrent Claude Code instances run outside any manager (mesh-tmuxHarness §1).

[Agent of Empires](https://github.com/DreamLab-AI/agentbox-of-empires) (AoE) is a mature session manager for exactly this problem: a ratatui TUI plus an `aoe serve` axum+React web dashboard that creates, monitors, attaches, and reviews interactive agent sessions, each in its own git worktree, each with a real `Running`/`Waiting`/`Idle`/`Error` status FSM, an embedded terminal, a live diff, and an HTTP/WS API (`POST /api/sessions`, `POST /api/sessions/{id}/send`, `GET /api/sessions/{id}/output`). Our fork `DreamLab-AI/agentbox-of-empires` at `d615b8c8` (v1.13.2) is a **clean mirror of upstream** — 2010 commits, zero DreamLab commits, zero carried patches (mesh-aoeCompat §"Fork status"). Upstream is hot (multiple PRs merged per day), so any `src/` patch becomes a rebase treadmill.

This PRD adopts AoE as **the** interaction plane and supersedes the MAD tmux layout (PRD-013/ADR-025) in place. It does so as an **overlay** — a pinned Nix flake input, a supervised daemon, a reverse proxy, config-seeded sessions and profiles — with **zero patches to AoE's crate**. And it uses the adoption to close the long-standing promised-vs-practised identity gap (PRD-019): agentbox already ships a full sovereign-identity fabric (`urn:agentbox` minting, per-agent `did:nostr`, NIP-98 auth, beads work-ledger, per-namespace memory, WAC mandates) but every piece is dormant or single-tenant in the running config (mesh-identityGap §2). The sprint wires that fabric to AoE **session boundaries**: each session gets its own `did:nostr`, its own URN, its own beads epic, its own memory namespace, fronted by a NIP-98 proxy that is the sole ingress to the daemon.

**If you remember only one thing:** AoE becomes the way interactive sessions are created and watched; agentbox keeps every sovereign surface it already owns and supplies AoE's missing identity by minting it at the session boundary. We adopt AoE's session manager, not its (absent) identity, and we carry the integration outside its crate so upstream stays a pin-bump away.

For the deep version, keep reading.

---

## 1. Goals

1. **Make AoE the canonical interaction plane.** The `aoe` TUI and `aoe serve` dashboard become the single way interactive agent sessions are created, monitored, attached, and reviewed, superseding the fifteen-window MAD layout of PRD-013/ADR-025 in one git-tracked upgrade with no parallel switchover (D1).
2. **Overlay-only, zero `src/` patches.** AoE enters as a pinned flake input and all integration — supervisor block, proxy, config seeds, profiles — lives in the agentbox repo. The fork stays a clean mirror (D2).
3. **Close the identity gap at the session boundary.** Turn the user-facing promise of per-user/per-project IRI, `did:nostr`, beads, auth, and namespaces into a running reality by wiring agentbox's existing (but dormant) identity fabric to AoE session lifecycle events (D4).
4. **Repoint the voice plane, not rebuild it.** `tab0-bridge` and the nostr gateway retarget from raw `tmux send-keys` to AoE's HTTP session API, with fail-open fallback to raw send-keys; the Unmute contract and the voice-intent semantic seam stay untouched (D5).
5. **Consolidate the browser session surface, retire the dead one.** AoE's dashboard absorbs the never-deployed setup/ops dashboard (PRD-012) and the tmux-console UX; the Perplexity research tab is retired to MCP; distinct capability surfaces (`/lo` viewer, code-server, VNC, Jupyter, ComfyUI) are kept as-is (D6, D7).
6. **Preserve every non-goal.** The headless consultant tier (dual-path, PRD-013 N06), model-routing projection (ADR-041), the entire management-api sovereign surface, the events hash chain, telemetry, relay, and pods all continue unchanged; absorbing sovereign panels *into* the AoE dashboard via the plugin API is explicitly deferred (D7).

---

## 2. Background: the interaction-surface sprawl

A seven-lead mesh investigation inventoried every interaction, web, API, telemetry, voice, and identity surface in the running container, cross-referenced against `flake.nix`, the running `agentbox.toml`, `management-api/`, and the AoE fork. The findings collapse to one fact: **agentbox has many capability surfaces but no session manager.** The management-api (`:9090`) is a sovereign control plane, not a session manager (mesh-apiTelemetry §Seam 4). The web faces are either distinct capability surfaces (code-server, VNC, Jupyter, ComfyUI, the `/lo` viewer) or a session-manager-shaped tool that nobody runs — the PRD-012 setup/ops dashboard binds `127.0.0.1:0` ephemeral and is not even a supervisor program (mesh-webSurfaces §1). The only interactive session surface is the tmux plane itself, and it is hand-rolled, driftable, and identity-blind.

### 2.1 Current-state inventory and disposition

Every interaction-relevant surface, its kind, live endpoint, auth, manifest gate, and this sprint's disposition. **Disposition** ∈ *keep* (unchanged), *absorb* (subsumed by the AoE dashboard/session model), *retire* (removed), *repoint* (retargeted at the AoE API). Citations are `file:line` against the repo unless marked live-probe.

| # | Surface | Kind | Endpoint | Auth | Gate | Disposition |
|---|---|---|---|---|---|---|
| 1 | Harness tabs 8–14 (OpenRouter/ZAI/Antigravity/DeepSeek/Perplexity/Ollama/Codex) | tui/tmux | `agentbox:8`–`:14` (`tmux-autostart.sh:119-391`) | per-profile (bearer / api-key / oauth) | always (window; self-warns if key unset) | **absorb** → AoE sessions |
| 2 | Tab 0 Claude coordinator | tui/tmux | `agentbox:0` (`tmux-autostart.sh:42-59`) | anthropic-oauth (global `~/.claude`) | always | **repoint** → named AoE session, terminal view (stays special, D5) |
| 3 | Operator-mutated region, windows 1–3 | tui/tmux | `agentbox:1`–`:3` (live: `tab0-bridge`/`simplilearm`/`agentbox`, 3 concurrent `claude`) | anthropic-oauth | n/a (hand-created) | **absorb** → formalised named sessions |
| 4 | Perplexity research shell | tui/tmux | `agentbox:12` (`tmux-autostart.sh:312-346`) | api-key (`PERPLEXITY_API_KEY`) | always | **retire** → `mcp__perplexity` + consultant-perplexity + `/perplexity-research` |
| 5 | Windows 4 Logs / 7 Git | tui/tmux | `agentbox:4`,`:7` (`tmux-autostart.sh:83-115`) | n/a (operator dashboards) | always | **absorb** → AoE dashboard log/diff view |
| 6 | Windows 5 System / 6 VNC | tui/tmux | `agentbox:5`,`:6` (`tmux-autostart.sh:90-110`) | n/a | always | **keep** (plain tmux windows) |
| 7 | Setup wizard + ops dashboard (PRD-012) | web-ui | SPA `setup/frontend/dist/` + axum `127.0.0.1:0` (`setup/server/src/main.rs:226`) | none (SPA); mgmt bearer passthrough | none (not a supervisor program) | **absorb** → AoE dashboard |
| 8 | Linked-object viewer `/lo/*` (S12) | web-ui | `:9090/lo/*` (`routes/linked-objects.js`; bundle `/opt/agentbox/browser`) | none (bundle auth-skipped `server.js:212-216`); data endpoints gated | `[linked_data.viewer].mode` (`agentbox.toml:1042-1043`) | **keep** (semantic browser, orthogonal) |
| 9 | code-server (browser VS Code) | web-ui | `:8080` `--auth none` (`flake.nix:1686-1699`) | none | `[toolchains].code_server` (`agentbox.toml:1089`) | **keep** — owns `:8080`, forces AoE off it |
| 10 | X11 desktop over VNC | web-ui | `:5901` (tigervnc, `flake.nix:1490-1500`) | none (`-SecurityTypes None`) | `[desktop].enabled` | **keep** |
| 11 | JupyterLab | web-ui | `:8888` (`flake.nix:1387-1396`) | none (empty token) | `[data_science].jupyter` | **keep** |
| 12 | ComfyUI (built-in) | web-ui | `127.0.0.1:8188` (`flake.nix:1703-1704`) | none (loopback) | media/comfyui builtin | **keep** |
| 13 | Swagger UI `/docs` | web-ui | `:9090/docs` (`server.js:280`) | bearer/nip98 | always | **keep** |
| 14 | Management API | http-api | `:9090` (`management-api/server.js`) | bearer/nip98 hybrid, auto-elevates to strict-nip98 when sovereign mesh on (`auth.js`) | always (core) | **keep** — becomes AoE's backend |
| 15 | Prometheus metrics | telemetry | `:9091/metrics` (`observability/metrics-server.js`) | none (scrape convention) | `[observability].metrics_port` | **keep** — AoE dashboard may scrape |
| 16 | HTTPS bridge (TLS reverse proxy) | other | `:3001` self-signed (`flake.nix:1588`) | TLS only | `sovereign.https_bridge` (`agentbox.toml:30`) | **keep / extend** → NIP-98 proxy host candidate (WS4) |
| 17 | tab0-bridge (voice/nostr hub) | voice | `:8971` `/tab0/send`→`tmux send-keys -t agentbox:0` (`server.mjs:92-99,424-428`) | optional token (empty=open, `server.mjs:35`) | `AGENTBOX_TAB0_BRIDGE` (`fleet-session-start.sh:31`) | **repoint** → `POST /api/sessions/{id}/send` (D5) |
| 18 | OpenAI-compat LLM endpoint (Unmute backend) | voice | `:8971` `/v1/chat/completions` (`server.mjs:401-407`) | none | always (part of bridge) | **keep** — Unmute↔bridge contract untouched |
| 19 | nostr inbound gateway (C2) | relay | `gateway.cjs` cloud-relay sub → `/tab0/send`; `/spawn`,`/instruct`→`tmux new-window` (`gateway.cjs:321-431`) | nostr sig + whitelist + replay | `AGENTBOX_NOSTR_GATEWAY` | **repoint** → `/spawn`→`POST /api/sessions`, chat→`/send` (D5) |
| 20 | voice-intent seam | http-api | `:9090 POST /v1/voice-intent` (`routes/voice-intent.js:82`) | nip98 speaker + signed mandate | mandate-gated (COM-15/ADR-037 D7) | **keep** — semantic/beam plane, orthogonal |
| 21 | nostr mirror / digests (kind-1059/30840/30841) | relay | `nostr-live-mirror.cjs`, `nostr-session-summary.py`, `project-tracking-publish.cjs` | signed; relay whitelist | `[sovereign_mesh.mobile_bridge]` / `[project_tracking]` | **keep** — telemetry egress, complements AoE push |
| 22 | Consultant tier (5 MCP) | mcp | stdio `mcp/consultants/{codex,antigravity,zai,perplexity,deepseek}/server.js` (`skills/mcp.json:379-507`) | provider env | `[consultants].enabled` + per-consultant | **keep** — dual-path (N06), never sessions |
| 23 | Model routing + AQE fleet routing | telemetry | `[model_routing]` (`agentbox.toml:846-870`); `model-routing-project.py` | none (config projection) | `[model_routing].enabled` (apply `boot`) | **keep** — config surface, not a session |
| 24 | Beads work-ledger adapter | adapter | `adapters/beads/local-sqlite.js:78-235` (no `/v1/beads` route) | n/a (dispatch) | `adapters.beads = "off"` (`agentbox.toml:12`) | **activate** (WS3) → `local-sqlite` + `routes/beads.js` |
| 25 | Scoped WAC mandate | lib | `lib/mandate.js:99-238` (no live route) | nip98-derived did | unwired | **activate** (WS3) → mount `/v1/mandate` |
| 26 | Per-user/per-project memory namespace | http-api | `:9090 /v1/memory` `_effectiveNamespace` (`routes/memory.js:57-73`) | nip98→`user:<pubkey>:<ns>`; bearer permissive | `[memory].admin_access_mode = "permissive"` (`agentbox.toml:316`) | **tighten** (WS3) → `scoped`, add project axis |
| 27 | AoE serve dashboard (**new**) | web-ui | `aoe serve … --port 9095` (not yet deployed) | random-token / passphrase / none (no identity, `serve.rs:18-33`) | new `[interaction_plane]` (WS1) | **add** behind NIP-98 proxy (WS4) |
| 28 | Voice console `:8444` / Unmute stack | voice | host `:8444` Caddy TLS; sibling `unmute-*` containers | self-signed TLS | external (VisionClaw) | **keep** — out of scope, host-owned |

**Reading the table.** Rows 1–7 are the interaction surfaces AoE subsumes; rows 8–13 are capability web faces that stay; rows 14–16 are the backend AoE integrates against; rows 17–21 are the voice/relay plane that repoints or stays; rows 22–23 are the deliberately-non-session paths that must survive; rows 24–26 are the dormant identity mechanisms the sprint activates; row 27 is the new daemon; row 28 is explicitly host-owned. The AoE dashboard replaces exactly one existing web face (row 7, which nobody runs) — it does **not** replace the JSON-LD viewer, the browser IDE, the desktop, the notebook, or the image UI (mesh-webSurfaces §"AoE replaceability summary").

### 2.2 The identity gap this sprint closes

The mesh identity audit (mesh-identityGap) found the sovereign fabric fully built but collapsed to a single-admin, single-tenant box in the running config: `adapters.beads = "off"` (no work ledger, no `/v1/beads` route), `[memory].admin_access_mode = "permissive"` (bearer/devuser reads and writes every namespace unprefixed), one profile → one `did:nostr` for the whole box, `mandate.js` complete but routeless, and the authority gate enabled but fail-closed with no local decision consumer. AoE's own auth stops at a random URL token with **no notion of a user, did, pubkey, or namespace** (`serve.rs:18-33`). The two systems solve the per-user-agent problem from opposite ends: agentbox has the identity/memory/URN plumbing with a dormant spawner; AoE has a mature spawner with no identity. The consolidation is **AoE owns session lifecycle; agentbox's `lib/uris.js` + `lib/agent-identity.js` + `routes/memory.js` + `adapters/beads` supply identity and ledger, called at session boundaries** (mesh-identityGap §5). WS3 is that wiring; it invents nothing.

---

## 3. Functional requirements — seven work streams

Requirements are `F`-prefixed. Per-work-stream effort is drawn from the AoE-compatibility seam table (mesh-aoeCompat §"Recommended sprint shape" and the eight scored seams).

### WS1 — Nix flake input + supervised daemon + manifest gate

*Effort: ~1 day (Nix flake merge **moderate**; supervisord program **trivial**).*

- **F1-1.** Add AoE as a pinned flake input `aoe.url = "github:DreamLab-AI/agentbox-of-empires/d615b8c8"` (or the `v1.13.2` tag) and pull `inputs.aoe.packages.${system}.aoe-with-web` (feature `serve` = axum + rust-embed baked dashboard) into the nix2container image package set. `crane` and `flake-parts` enter only as transitive inputs of the AoE flake; agentbox's `flake-utils` outputs are not restructured (mesh-aoeCompat §Seam 1).
- **F1-2.** Pin discipline: the pin is a commit or tag, freezing the web frontend's `npmDepsHash`. Bumping the pin past a `web/package-lock.json` change **requires recomputing `npmDepsHash`** in the same commit or the Nix build breaks (D8; NFR N-08).
- **F1-3.** Add a flake-generated, manifest-gated supervisord program running the Nix-built binary as `user=devuser`: `aoe serve --auth none --behind-proxy --host 127.0.0.1 --port 9095`. Port **9095** is mandatory: `8080` is code-server (row 9, live) and `7777` is the nostr relay (row 21) — both occupied (D3; D8).
- **F1-4.** Add a `[interaction_plane]` table to `agentbox.toml` (§Appendix A): `enabled`, `port`, `dashboard` (on/off), `session_seeds` (declarative session list replacing the tmux-autostart harness windows), `proxy_auth = "nip98"`.
- **F1-5.** Add an honest `system-manifest.js` catalogue entry per ADR-039: the daemon + config is apply-class **`boot`**; the binary (flake input) is apply-class **`rebuild`**. With `[interaction_plane].enabled = false` the daemon never starts and no session seeds are provisioned.

### WS2 — Sessions and profiles (harness tabs → AoE sessions)

*Effort: ~2–3 days (tmux coexistence **trivial**; MAD-layout rewrite + 7-console agent coverage **moderate**).*

- **F2-1.** AoE coexists with the `agentbox` tmux session with no collision: AoE namespaces every session under `SESSION_PREFIX = aoe_` as separate top-level tmux sessions `aoe_<title>_<id8>` and its sweep touches only `aoe_*` names (mesh-aoeCompat §Seam 2). Both live on one tmux server.
- **F2-2.** Rewrite `config/tmux-autostart.sh`'s MAD layout into declarative `[interaction_plane].session_seeds` (or `aoe add --tool <agent> --profile <name>` calls). The rewrite **reconciles the actual running layout**, not just the committed script — windows 1–3 have diverged and a fifteenth Codex window is live (D8; mesh-tmuxHarness §1).
- **F2-3.** Native ACP agents map with zero config: **claude** (tab 0 + ad-hoc), **codex** (tab 14), **gemini** (tab 10 Antigravity) are keyed natively in `src/acp/agent_registry.rs` (D6; mesh-aoeCompat §Seam 3).
- **F2-4.** OpenRouter (tab 8) and Z.AI (tab 9) are the `claude` binary redirected via `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`. **`ANTHROPIC_BASE_URL` is NOT in AoE's default env-forward set** (**top sprint risk**, D8; NFR N-01). **Mechanism (operator decision 2026-08-04): thin wrapper scripts registered via `agent_command_override`** — each wrapper asserts the profile env exists, exports the redirect, **hard-fails loudly** if `ANTHROPIC_BASE_URL`/token are missing, then `exec claude`. This converts the silent mis-billing failure mode into an immediate visible launch failure, structurally rather than by test coverage. Per-AgentSpec `env_allowlist` remains the documented alternative; `settings.local.json` stays runtime-written.
- **F2-5.** DeepSeek/codewhale (tab 11) and Ollama-Gemma-LAN/nanocoder (tab 13) map to `custom_agents` entries (tmux view) with `agent_detect_as = claude|codex` for status heuristics where they fit (D6).
- **F2-6.** The Perplexity tab (tab 12) is **retired** — it is a curl research shell with no worktree, never a coding agent. Research stays on `mcp__perplexity` + consultant-perplexity + `/perplexity-research` (D6; F-retirement).
- **F2-7.** AoE's built-in per-session git-worktree model supersedes the hand-rolled `harness/<name>` worktree block (`tmux-autostart.sh:400-427`); the `harness-merge` helper is reworked to target AoE worktree branches (D6). **AoE's per-session Docker sandboxing stays DISABLED** (operator decision 2026-08-04): sessions run our own repos under our own keys inside the agentbox container, profile isolation is the isolation model, and AoE's `docker exec` sandbox would re-enter the documented DinD stale-mount footgun. Revisit only for untrusted-code sessions, with the sandbox image built on the true host.
- **F2-9.** AoE runs on the **shared default tmux socket** (operator decision 2026-08-04, no `AOE_TMUX_SOCKET`): operator `tmux attach` and the voice bridge's read-only pane captures keep working across the whole estate; the upstream-tested `aoe_` prefix sweep discipline is the collision guard (F2-1).
- **F2-8.** Fix the Antigravity model discrepancy: `gemini-2.5-flash` in the tab (`tmux-autostart.sh:259`) versus `gemini-3.5-flash` in `[consultants.antigravity]` (`agentbox.toml:810`). Align both (D6).

### WS3 — Session identity, beads ledger, memory namespaces

*Effort: ~2 days (identity NIP-98 seam **moderate** in WS4; the wiring here is new but every mechanism pre-exists — mesh-identityGap §4).*

- **F3-1.** **Per-session `did:nostr`.** Each AoE session spawns with `AGENTBOX_PROFILE=<session-slug>` so `management-api/lib/agent-identity.js` `loadOrMint()` derives a distinct persisted BIP-340 keypair (keyfile `0600` under `/var/lib/agentbox/identities/agent-did-<profile>.key`, `agent-identity.js:107-160`). No session exists without a `did:nostr` (invariant, NFR N-09).
- **F3-2.** **Per-session URN.** A session-create hook (an AoE session-lifecycle → thin management-api shim) mints `urn:agentbox:activity:<scope>:session-<sha256-12>` via `lib/uris.js` `mint()` and stamps it on the session record. Reuse the existing `activity` kind (`uris.js:93`); ad-hoc URN construction stays prohibited (ADR-013).
- **F3-3.** **Beads work-ledger ON.** Flip `adapters.beads = "local-sqlite"` (rebuild-class) and add a `routes/beads.js` HTTP surface. Session lifecycle maps to the adapter (`local-sqlite.js:78-235`): session create → `createEpic`, task/turn units → `createChild`/`claim`, session end → `close`. Bead URNs are already minted by the adapter.
- **F3-4.** **Per-project memory namespaces.** Extend `_effectiveNamespace` (`routes/memory.js:57-73`) with a project axis: `user:<pubkey>:proj:<repo-slug>:<ns>`. Flip `[memory].admin_access_mode` to `"scoped"` (rebuild-class, baked `MEMORY_ADMIN_ACCESS_MODE`) so sessions cannot read each other's namespaces; the operator retains a documented break-glass bearer path (ADR-043).
- **F3-5.** **Mandates — lazy** (operator decision 2026-08-04). Mount `/v1/mandate` (create/revoke) over the complete-but-unwired `lib/mandate.js` (`:99-238`). A session's mandate is minted **on first pod write** (mint-if-absent in the shim, scoped to the container being written); session seeds carry `eager_mandate = true` for known pod-writers. Worktree-only sessions never mint one (ADR-043 D4.5).
- **F3-6.** **Authority-gate consumer — both, layered** (operator decision 2026-08-04). The embedded relay is the canonical consumer: `awaitDecision` subscribes for Schnorr-signed kind-31403 decisions answering the gate's 31402 (mobile approval via the existing Amethyst/Amber allowlisted key works day one). A **pending-approvals dashboard surface** is the second front door: it renders open 31402s and, on click, signs and publishes a 31403 via the operator delegation key (NIP-98-authed; unsigned HTTP approval prohibited) (`authority.js:217-224`; ADR-043 D4.7).

### WS4 — NIP-98 identity proxy in front of the daemon

*Effort: ~1 day (identity seam **moderate**; NIP-98 already runs on 3 of 4 identity-bearing HTTP surfaces — mesh-identityGap §5).*

- **F4-1.** The **only** ingress to `:9095` is a NIP-98-verifying reverse proxy — extend the existing https-bridge (`:3001`) or add a sibling thin proxy reusing `management-api/middleware/auth.js` verification, forwarding to the daemon with `X-Forwarded-For`. `aoe serve` runs `--behind-proxy --auth none` on loopback (D4.6).
- **F4-2.** The proxy verifies the kind-27235 NIP-98 header (reusing the `verifyNip98` contract already live on the mgmt-api) and populates a session pubkey from the signature; this is the identity that F3-1's `AGENTBOX_PROFILE` and F3-4's namespace derive from.
- **F4-3.** **Invariant:** nothing other than the proxy may reach `:9095`. `--behind-proxy` trusts `X-Forwarded-For`, so the daemon MUST bind `127.0.0.1` and the proxy MUST be the sole ingress, or any container-local process reaching the port bypasses auth (D8; NFR N-05, invariant).
- **F4-4.** Native NIP-98 inside AoE's `auth.rs` is **rejected** in favour of the proxy (avoids a `src/` patch against a hot upstream). The pluggable `TokenSource` enum at `auth.rs:465` is recorded as the hook point should this ever be revisited (D2; ADR-042 alternatives).

### WS5 — Voice-plane repoint

*Effort: ~½ day (voice injection seam **trivial** — a direct 1:1 endpoint swap — mesh-aoeCompat §Seam 6).*

- **F5-1.** Repoint `sendToTab0()` (`server.mjs:92-99`) from `tmux send-keys -t agentbox:0` to `POST /api/sessions/{id}/send`, gaining the per-agent paste-burst delay and server-side per-session serialisation AoE provides. Resolve the tab-0 session id at bridge start via `GET /api/sessions?state=live` and pin it in config (D5).
- **F5-2.** **Fail-open fallback.** If AoE is down, fall back to raw `tmux send-keys` (matching the nostr-gateway precedent `gateway.cjs:231`). Voice never hard-fails on a missing daemon (NFR N-03).
- **F5-3.** The **tab-0 coordinator session runs in terminal view**. AoE's default ACP structured view has no tmux pane, so `POST /send` returns `400 acp_mode_unsupported` (`docs/structured-view.md:3-5`; mesh-voiceTab0 §caveat 2). Adopting AoE's ACP prompt channel for voice is explicit roadmap, not sprint (D5; D8).
- **F5-4.** Repoint the nostr gateway: `/spawn` → `POST /api/sessions`; `/instruct` → `/send` (D5). The gateway's chat path already rides `/tab0/send`, so it follows F5-1 for free.
- **F5-5.** **Untouched:** the Unmute↔bridge `/v1/chat/completions` contract, the `/v1/voice-intent` semantic seam (kind-31402 dispatch + agent_action beams), the NIP-59 mirror, and the kind-30840/30841 digests. The bridge's `/feed`+`/turns` transcript stays; AoE push notifications **complement**, not replace. The turn-sink hook is retained for the transcript but is no longer load-bearing for status — AoE's status FSM owns that (D5).

### WS6 — Dashboard consolidation and retirements

*Effort: ~1 day (web-dashboard-vs-management-api seam **moderate**; near-zero overlap — mesh-aoeCompat §Seam 4).*

- **F6-1.** The AoE dashboard absorbs the PRD-012 setup/ops dashboard (row 7) — same "manage/observe the box from a browser" intent, and the PRD-012 surface is not even deployed (binds `127.0.0.1:0`, no supervisor program). AoE's dashboard is the live browser session console.
- **F6-2.** Windows 4 (Logs) and 7 (Git) are absorbed into the AoE dashboard's log and diff views; windows 5 (System) and 6 (VNC) stay as plain tmux windows (D1).
- **F6-3.** **Kept unchanged** (distinct capability surfaces, no AoE equivalent): the `/lo` linked-object viewer (row 8), code-server (row 9), the VNC desktop (row 10), JupyterLab (row 11), ComfyUI (row 12), Swagger `/docs` (row 13), and the full management-api sovereign surface — payments, llm-marketplace, pods/pod-git, uri-resolver, kg-elevation, `/v1/system`, memory→pod (D7).
- **F6-4.** **Deferred, recorded as the follow-up, not sprint scope:** absorbing the sovereign panels *into* the AoE dashboard via the `aoe-plugin-api` (`API_VERSION = 10`, `aoe-plugin-api/src/capability.rs`; `RuntimeSpec` JSON-RPC workers, dockable pane slots), and a plugin worker that mirrors AoE's SQLite session-event log into RuVector/the events chain. The plugin runtime is beta (D7; D8).

### WS7 — Documentation synchronisation

*Effort: ~½ day.*

- **F7-1.** This PRD ships with its sibling decision records: ADR-042 (adoption + overlay-only, supersedes ADR-025), ADR-043 (session identity binding), ADR-044 (voice-plane repoint), and DDD-019 (interaction-plane bounded context). Each cross-links the others and the superseded PRD-013/ADR-025.
- **F7-2.** The docs listed in `agentbox/CLAUDE.md` §"Docs to keep in sync" (`README.md`, `docs/user/quickstart.md`, `browsercontainer/README.md`, `docs/developer/code-as-harness.md`, `docs/developer/ecosystem.md`, `config/tab0-bridge/README.md`) are updated to describe the AoE interaction plane. **The old PRD-013/ADR-025 and the README indexes are updated in a separate pass**, not by this sprint (per brief).

---

## 4. Non-functional requirements

Requirements are `N`-prefixed. Several are hard invariants (marked).

- **N-01 — Profile-isolation invariant (hard).** Every routed Claude harness must run with `HOME` **and** `CLAUDE_CONFIG_DIR` both pointed at `$WORKSPACE/profiles/<name>` so it reads that profile's runtime-written `settings.local.json` (its own `ANTHROPIC_BASE_URL`/token) and never the global `~/.claude` that carries the direct-Anthropic key (`tmux-autostart.sh:170-174`). AoE must reproduce this per session or redirected harnesses leak onto the direct-Anthropic key and mis-bill. The live key is written to `settings.local.json` at **runtime**, never baked into the image.
- **N-02 — Do not reintroduce pseudo-user isolation.** Profile isolation replaced Linux pseudo-user isolation (`CLAUDE.md` §Runtime model); AoE sessions ride profiles, not per-uid users.
- **N-03 — Fail-open voice fallback.** The voice repoint (WS5) falls back to raw `tmux send-keys` when AoE is unreachable, matching the gateway precedent (`gateway.cjs:231`). No voice or relay path hard-fails on a missing daemon.
- **N-04 — Dual-path consultants (PRD-013 N06 carry-over, hard).** The five headless consultant MCPs remain functional throughout and after the transition. They are **not** sessions and are never converted to AoE sessions — they are the cost-effective small-query path alongside interactive sessions (PRD-013:203; mesh-tmuxHarness §4). Consultant deprecation would be a routing preference, never a removal.
- **N-05 — Proxy sole ingress (hard).** The NIP-98 proxy is the only reachable ingress to `:9095`; the daemon binds `127.0.0.1` under `--behind-proxy` (F4-3). Violating this bypasses identity entirely.
- **N-06 — No `src/` patches (hard).** All integration lives in the agentbox repo — flake input, supervisor block, proxy, config seeds, profiles, future plugins. The AoE fork stays a clean mirror; any `src/` patch is prohibited as a rebase treadmill against a hot upstream (D2; mesh-aoeCompat §Seam 8).
- **N-07 — Canonical identifiers only.** Every durable identifier minted at a session boundary goes through `management-api/lib/uris.js`; ad-hoc `format!()`/template-literal URNs are prohibited (ADR-013).
- **N-08 — Pin discipline.** The AoE flake pin is a commit or tag; a pin bump that moves `web/package-lock.json` must recompute `npmDepsHash` in the same commit (F1-2; D8).
- **N-09 — No session without identity (hard).** Every AoE-managed session has a `did:nostr` (F3-1), a URN (F3-2), a beads epic (F3-3), and a scoped memory namespace (F3-4). Sessions are the identity boundary.
- **N-10 — Preserve the sovereign surface.** The management-api, events hash chain, telemetry (`:9091`), relay (`:7777`), solid-pod (`:8484`), voice-intent seam, and all MCP servers continue unchanged; observability (span + log + metrics per adapter dispatch) and the three middleware layers (observability → privacy → JSON-LD) are untouched (ADR-005/008/012).

---

## 5. Implementation phases — one-shot sprint

A single git-tracked upgrade, no parallel switchover (D1). Phases are ordered by dependency; the two rebuild-class flips are **grouped into one image rebuild** so the container is recreated exactly once.

### Phase 0 — Reconcile the live layout (day 0, before any change)

Capture the **actual** running tmux layout (windows 1–3 diverged, fifteenth Codex window live) and the running gate state, so WS2's rewrite reconciles reality, not the stale `tmux-autostart.sh` spec (D8; mesh-tmuxHarness §1).

### Phase 1 — Rebuild-class pass: flake input + gates + daemon (≈ days 1–2)

Grouped because all three need `nix build` + container recreate:
- **F1-1** flake input (`aoe-with-web`, apply-class `rebuild`), **F1-3/F1-5** gated supervisord `aoe serve … --port 9095` (`boot`), **F1-4** `[interaction_plane]` table.
- **F3-3** `adapters.beads = "local-sqlite"` (rebuild-class) and **F3-4** `[memory].admin_access_mode = "scoped"` (rebuild-class, baked env) land here — the single image rebuild carries the daemon binary *and* both identity flips (mesh-identityGap §5).
- One `./scripts/launch.sh rebuild dev` on the host tab (per `CLAUDE.md` build rules), then verify the daemon is up on `:9095` behind loopback.

### Phase 2 — Identity proxy + session-boundary wiring (≈ days 2–3, boot/live-class)

- **WS4** NIP-98 proxy in front of `:9095` (F4-1/F4-2/F4-3).
- **WS3** session-create shim: `AGENTBOX_PROFILE` per session (F3-1), URN mint (F3-2), beads epic/child/claim/close mapping and `routes/beads.js` (F3-3), project-axis namespace (F3-4), `/v1/mandate` mount (F3-5), local `awaitDecision` consumer (F3-6).

### Phase 3 — Sessions + profiles (≈ days 3–5)

- **WS2** session_seeds rewrite (F2-2), native agents (F2-3), OpenRouter/ZAI `env_allowlist` for `ANTHROPIC_BASE_URL` (F2-4 — the mis-billing guard), custom_agents for DeepSeek/Ollama (F2-5), Perplexity tab retirement (F2-6), worktree/harness-merge rework (F2-7), Antigravity model fix (F2-8).

### Phase 4 — Voice repoint (≈ day 5)

- **WS5** `sendToTab0()` → `/api/sessions/{id}/send` with fail-open fallback (F5-1/F5-2), terminal-view tab-0 (F5-3), gateway `/spawn`→`/api/sessions` (F5-4); Unmute/voice-intent/digests left untouched (F5-5).

### Phase 5 — Dashboard consolidation + docs (≈ days 5–6)

- **WS6** absorb the PRD-012 setup dashboard and Logs/Git windows (F6-1/F6-2), confirm kept surfaces unchanged (F6-3), record the plugin-absorption follow-up (F6-4).
- **WS7** ship ADR-042/043/044 + DDD-019 and sync the operator docs (F7-1/F7-2).

**Total ≈ 6 days**, one image rebuild (Phase 1), no second switchover.

---

## 6. Risks and mitigations

Carried from the decision brief D8; each with the sprint's mitigation.

| Risk | Impact | Mitigation |
|---|---|---|
| **`ANTHROPIC_BASE_URL` env-forward gap** — not in AoE's default forward set; OpenRouter/ZAI sessions silently mis-bill to direct Anthropic | High (cost + wrong model) | F2-4: explicit per-AgentSpec `env_allowlist` entry or `agent_command_override` wrapper; verified by the zero-mis-billing success criterion (§7.3) |
| **Port collisions** — `aoe serve` default `8080` = code-server, docs example `7777` = nostr relay | High (daemon won't bind) | F1-3: pin `--port 9095` explicitly in the supervisor block |
| **Behind-proxy trust** — `--behind-proxy` trusts `X-Forwarded-For`; any local process reaching `:9095` bypasses auth | High (identity bypass) | N-05/F4-3 invariant: daemon binds `127.0.0.1`, NIP-98 proxy is sole ingress |
| **Upstream velocity vs pin discipline** — multiple PRs/day; a `src/` patch is a rebase treadmill; a pin bump can break `npmDepsHash` | Medium | N-06 (no src patches) + N-08 (recompute `npmDepsHash` on pin bump); overlay-only |
| **Rebuild-class gates** — beads + `admin_access_mode` need `nix build` + recreate | Medium | Phase 1 groups both flips with the binary into one image rebuild |
| **ACP-vs-terminal-view for voice** — ACP structured sessions have no pane → `400 acp_mode_unsupported` | Medium | F5-3: tab-0 runs terminal view; ACP prompt channel is roadmap |
| **Live layout diverged from spec** — windows 1–3 repurposed, fifteenth window live | Medium | Phase 0: reconcile the actual running layout, not the committed script |
| **Plugin absorption is beta** — moving sovereign panels into the dashboard needs the newer plugin runtime | Low (deferred) | F6-4: recorded as follow-up, out of sprint scope |
| **Live-WS privacy bypass** — `/sessions/{id}/live-ws` streams raw tmux pane bytes and accepts keystrokes (`src/server/live_ws.rs`); re-exposing it through any agentbox surface would bypass the ADR-008 observability→privacy→JSON-LD middleware chain | Medium | The NIP-98 proxy is the sole ingress (N-05); the live view is operator-plane only and is never re-published through management-api or the sovereign mesh; recorded as a hard constraint for the plugin-absorption follow-up |
| **AoE's SQLite event store is a second durable log** — ACP replay, live-WS catch-up, and the watchdogs all read it; replacing it with the events adapter slot would be fork-invasive | Low | Accept SQLite as AoE's *operational* store (overlay-only, N-06); a follow-up plugin worker mirrors AoE session events into RuVector/the events chain so the sovereign audit record stays complete |

---

## 7. Success criteria

Measurable and binary unless stated.

### 7.1 Interaction plane

1. **Daemon up, correctly gated.** With `[interaction_plane].enabled = true`, `aoe serve` is live on `127.0.0.1:9095` under the supervisor as `user=devuser`; with it `false`, no daemon runs and no session seeds are provisioned. Neither `8080` nor `7777` is touched.
2. **Sessions replace harness tabs.** The seven interactive harnesses (OpenRouter/ZAI/Antigravity/DeepSeek/Ollama/Codex + ad-hoc Claude) are created and monitored as AoE sessions with a live status FSM; the Perplexity tab no longer exists (research resolves via `mcp__perplexity`).
3. **Zero direct-Anthropic mis-billing.** An OpenRouter or Z.AI session's requests reach `openrouter.ai` / `api.z.ai` respectively — verified by request destination — with the global `~/.claude` direct-Anthropic key never used (N-01/F2-4).

### 7.2 Identity binding

4. **Every session is resolvable.** Each AoE session carries a `urn:agentbox:activity:<scope>:session-<sha256-12>` minted via `uris.js`, resolvable through `GET /v1/uri/<urn>` (307/404/410).
5. **Distinct did per session.** Two concurrent sessions have two distinct persisted `did:nostr` keyfiles under `/var/lib/agentbox/identities/` (one per `AGENTBOX_PROFILE`).
6. **Beads ledger non-empty.** After a session runs, the beads ledger has a `createEpic` for it with `createChild`/`claim` units and a `close` on session end; `adapters.beads = "local-sqlite"` and `/v1/beads` responds.
7. **Namespace isolation.** With `admin_access_mode = "scoped"`, a session cannot read another session's `user:<pubkey>:proj:<repo-slug>:<ns>` namespace; the operator break-glass bearer path still can (documented in ADR-043).
8. **Proxy is sole ingress.** A NIP-98-less request to `:9095` from the proxy path is rejected; the daemon is unreachable except via the proxy (N-05).

### 7.3 Voice and preservation

9. **Voice round-trips via AoE.** A spoken/remote command reaches the tab-0 session through `POST /api/sessions/{id}/send` (not raw send-keys) when AoE is up, and falls back to `tmux send-keys` when the daemon is down — both delivering the keystrokes (N-03/F5-2).
10. **Non-goals intact.** The five consultant MCPs still answer `/consult` (N-04); `[model_routing]` still projects at boot (ADR-041); the management-api sovereign surface, events hash chain, telemetry `:9091`, relay `:7777`, and voice-intent seam are unchanged (N-10). The Unmute `/v1/chat/completions` contract and the kind-30840/30841 digests are byte-for-byte untouched.
11. **Overlay verified.** `git -C agentbox-of-empires log --oneline DreamLab-AI..HEAD` shows zero DreamLab commits; all AoE integration is in the agentbox repo (N-06).

---

## Appendix A — `[interaction_plane]` session-seed sketch

The `[interaction_plane]` manifest table replaces the harness half of `tmux-autostart.sh` with a declarative session list. Illustrative, not final schema:

```toml
[interaction_plane]
enabled     = false                 # master gate; false ⇒ no daemon, no seeds (apply-class boot)
port        = 9095                  # aoe serve bind (127.0.0.1 only, behind proxy); NOT 8080/7777
dashboard   = "on"                  # aoe serve web dashboard
proxy_auth  = "nip98"               # sole-ingress reverse proxy verifies NIP-98 → session pubkey

# Declarative sessions replacing tmux-autostart harness windows 8–14.
# Each seed derives a did:nostr (AGENTBOX_PROFILE=<slug>), a session URN, a beads epic,
# and a scoped memory namespace user:<pubkey>:proj:<repo>:<ns> at create time.
[[interaction_plane.session_seeds]]
slug        = "codex"               # native ACP agent
tool        = "codex"
worktree    = true

[[interaction_plane.session_seeds]]
slug        = "antigravity"         # native gemini --acp; model aligned to gemini-3.5-flash (F2-8)
tool        = "gemini"
worktree    = true

[[interaction_plane.session_seeds]]
slug        = "openrouter"          # claude binary redirected — env_allowlist is load-bearing (F2-4)
tool        = "claude"
worktree    = false
env_allowlist = ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN"]

[[interaction_plane.session_seeds]]
slug        = "zai"                 # claude → api.z.ai/api/anthropic; same allowlist guard
tool        = "claude"
worktree    = false
env_allowlist = ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN"]

[[interaction_plane.session_seeds]]
slug        = "deepseek"            # custom_agent (codewhale), agent_detect_as = codex
tool        = "custom:codewhale"
worktree    = true
detect_as   = "codex"

[[interaction_plane.session_seeds]]
slug        = "ollama"              # custom_agent (nanocoder) → LAN llama.cpp
tool        = "custom:nanocoder"
worktree    = true
detect_as   = "claude"

# tab-0 coordinator: named, special, TERMINAL VIEW (ACP has no pane → 400 acp_mode_unsupported, F5-3)
[interaction_plane.coordinator]
slug        = "tab0"
tool        = "claude"
view        = "terminal"           # required for the voice send-keys/`/send` path
```

Perplexity has **no seed** — it is retired to MCP (F2-6). The consultant tier is unaffected: it is not part of `[interaction_plane]` and stays under `[consultants]` (N-04).

## Appendix B — Port map, before and after

| Port | Before | After | Note |
|---|---|---|---|
| 9095 | *(free)* | **`aoe serve` (loopback, behind proxy)** | new; chosen to avoid 8080/7777 collisions |
| 3001 | https-bridge (TLS shim) | https-bridge **or** NIP-98 proxy host for `:9095` | extended, or a sibling thin proxy added (F4-1) |
| 8080 | code-server (`--auth none`) | code-server (unchanged) | AoE default would collide here — forced off it (F1-3) |
| 7777 | nostr relay (loopback) | nostr relay (unchanged) | AoE docs example port would collide — avoided |
| 8971 | tab0-bridge → `send-keys -t agentbox:0` | tab0-bridge → `POST :9095/api/sessions/{id}/send` (fallback send-keys) | repointed (WS5) |
| 9090 | management-api (sovereign control plane) | management-api (unchanged) — **becomes AoE's backend** | keep (row 14) |
| 9091 | Prometheus `/metrics` | unchanged | AoE dashboard may scrape (keep) |
| 8484 | solid-pod-rs | unchanged | keep |
| 8080/8188/8888/5901 | code-server / ComfyUI / Jupyter / VNC | unchanged | distinct capability surfaces (keep) |
| 8443/8444 | Unmute demo / voice console (VisionClaw) | unchanged | out of scope, host-owned |

---

### Cross-references

- [ADR-042 — Agent of Empires interaction plane](../adr/ADR-042-agent-of-empires-interaction-plane.md) — adoption + overlay-only (D1–D3, D6, D7); supersedes ADR-025
- [ADR-043 — Session identity binding](../adr/ADR-043-session-identity-binding.md) — D4 in full
- [ADR-044 — Voice-plane AoE repoint](../adr/ADR-044-voice-plane-aoe-repoint.md) — D5
- [DDD-019 — Interaction-plane domain](../ddd/DDD-019-interaction-plane-domain.md) — bounded context, aggregates, invariants
- [PRD-013 — Multi-harness tmux architecture](PRD-013-multi-harness-tmux-architecture.md) — **superseded in part** (the tmux harness layout)
- [ADR-025 — Multi-harness tmux architecture](../adr/ADR-025-multi-harness-tmux-architecture.md) — **superseded**
- [ADR-013 — Canonical URI grammar](../adr/ADR-013-canonical-uri-grammar.md) — session URN minting
- [ADR-017 — Multi-tenant did:nostr pods](../adr/ADR-017-multi-tenant-did-nostr-pods.md) — identity fabric
- [ADR-028 — Per-user agent fabric](../adr/ADR-028-per-user-agent-fabric.md) — the spawner AoE supersedes
- [ADR-039 — Apply-class catalogue](../adr/ADR-039-docbox-backported-surfaces.md) — boot/rebuild classing
- [ADR-041 — Model routing](../adr/ADR-041-model-routing-one-policy-many-projections.md) — untouched
- [PRD-019 — Gap-close](PRD-019-gap-close-agentbox.md) — the identity gap this sprint activates
- [PRD-012 — Setup dashboard](PRD-012-setup-dashboard.md) — absorbed by the AoE dashboard
- [PRD-006 — Linked-data interfaces](PRD-006-linked-data-interfaces.md) — `/lo` viewer retained
- [PRD-017 — Sovereign project tracking](PRD-017-sovereign-project-tracking.md) — kind-30840/30841 digests untouched
- [`config/tmux-autostart.sh`](../../../config/tmux-autostart.sh) — the superseded MAD layout
- [`config/tab0-bridge/server.mjs`](../../../config/tab0-bridge/server.mjs) — the voice injection seam repointed
- [`management-api/lib/uris.js`](../../../management-api/lib/uris.js) — URN minting
- [`management-api/lib/agent-identity.js`](../../../management-api/lib/agent-identity.js) — per-profile did:nostr
- [`management-api/adapters/beads/local-sqlite.js`](../../../management-api/adapters/beads/local-sqlite.js) — work-ledger adapter
- [Agent of Empires fork](https://github.com/DreamLab-AI/agentbox-of-empires) — pinned at `d615b8c8` (v1.13.2), clean mirror
