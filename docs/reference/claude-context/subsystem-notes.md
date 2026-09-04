# Subsystem Notes — Relocated CLAUDE.md Detail

> Relocated verbatim from `CLAUDE.md` (2026-07-30 Claude-5 context-engineering slimming).
> Load this file when working on the specific subsystem; the top-level `CLAUDE.md`
> carries only a one-line pointer per section.

## URI/URN Parallel Namespace (VisionClaw)

Parallel namespace: the host project's Rust substrate uses the converged `urn:visionclaw:<kind>:...` grammar minted in `src/uri/` — 5 URN kinds plus `did:nostr` for identity. The kinds are *not* uniformly `<hex-pubkey>:<local>`; their shapes differ by kind:

- `concept:<domain>:<slug>` — domain-scoped (post-elevation shared ontology class)
- `kg:<hex-pubkey>:<sha256-12>` — owner-scoped, content-addressed (personal KG node)
- `bead:<hex-pubkey>:<sha256-12>` — owner-scoped, content-addressed
- `execution:<sha256-12>` — content-addressed, **unscoped** (owner travels in `owner_did`)
- `group:<team>#members` — team-scoped
- identity is `did:nostr:<hex-pubkey>` — there is **no** `urn:visionclaw:agent` kind; an agent's identity *is* its DID.

Owner-scoped kinds use the 64-char hex pubkey as scope (not bech32 npub). This grammar is converged across agentic worktrees but **not yet merged to VisionClaw main** (main still carries the legacy `urn:ngm:node/edge/domain` scheme). Until it merges, `management-api/lib/bc20-provenance-bridge.js` (+ its sovereign test) is the executable definition of the BC20 anti-corruption layer that maps between the two namespaces at the federation boundary (B05: the only cross-namespace importer).

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

- **Rendering**: Both WebGPU and WebGL are hardware-accelerated via Vulkan/ANGLE on RTX 6000. `--enable-unsafe-webgpu` allows WebGPU on HTTP origins; VisionClaw currently uses WebGL (Three.js).
- **TREAT_AS_SECURE**: Env var lists HTTP origins Chrome treats as secure contexts (for SharedArrayBuffer). Expanded to `--unsafely-treat-insecure-origin-as-secure=` flags per origin.
- **SharedArrayBuffer**: Requires `isSecureContext` (TREAT_AS_SECURE) + COOP/COEP headers from the target server.
- **Network**: `visionclaw_network` (external). Agents reach MCP at `http://browsercontainer:8931/sse`.
- **GPU**: Quadro RTX 6000 via UUID. Optional — healthcheck warns but doesn't fail without it.

## Code-as-Harness URN Allocation

(PRD-008, ADR-018, ADR-019, ADR-020, DDD-005). Code execution and experiential learning emit URNs under the existing 18 kinds — no new kinds are added. Mapping:

- KernelSession → `urn:agentbox:thing:<scope>:kernel-<id>`
- ExecutionTrace → `urn:agentbox:activity:<scope>:trace-<id>` (action receipt)
- DistilledLesson → `urn:agentbox:memory:<scope>:lesson-<sha256-12>`
- VerifiedSkill → `urn:agentbox:skill:<scope>:<name>:v<n>`
- ACI session → `urn:agentbox:thing:<scope>:aci-<id>`
- ACI submission → `urn:agentbox:receipt:<scope>:aci-<id>`

Every record carries `owner_did = did:nostr:<hex>` and an associated `action_urn = urn:agentbox:activity:<scope>:<verb>-<id>` Activity record (PROV-O aligned). The `<scope>` is always the 64-character BIP-340 x-only hex pubkey. All URNs are minted through `management-api/lib/uris.js`; ad-hoc template-literal construction is prohibited. Code-as-harness is the fifth participant in the `did:nostr` identity mesh — joining solid-pod-rs (NIP-98 auth), nostr-rust-forum (event signing), VisionClaw (graph governance), and dreamlab-ai-website (forum config) without inventing new identity primitives.

`mcp/aci-shell` (fixed 2026-07-05) is packaged as a proper npm closure — `makeNpmService` in `flake.nix`, `@modelcontextprotocol/sdk` pinned to `^1.0.0` (lockfile + prefetched `npmDepsHash`), overlaid into `/opt/agentbox/mcp/aci-shell` with `node_modules` baked in. The entrypoint's phase-6 `_probe_closure` check passes once `skills.aci_shell.enabled` is on.

## RuvNet Brain (Source-Grounded KB in the Sidecar)

The [ruvnet-brain](https://github.com/stuinfla/ruvnet-brain) corpus (~90k source chunks from 21+ RuvNet ecosystem repos: ruflo, ruvector, safla, agentdb, agentic-flow, sparc, etc) is ingested INTO the shared ruvector-postgres sidecar under namespace **`ruvnet-kb`** — embedded client-side via Xinference `bge-small-en-v1.5` (384-dim, ADR-015), the same embedding space and `memory_entries` table as all other agent memory. The upstream retrieval stack (`@ruvector/rvf` file stores + `@xenova/transformers` in-process embedder) is deliberately NOT run: the corpus is the value, the substrate is ours. No second embedder, no second vector store, no 512 MB in-memory model.

**Ingest playbook**: `scripts/ruvnet-brain-ingest.mjs` — auto-runs at boot (backgrounded, after the Xinference readiness gate) when `auto_ingest = true`; every boot/build reconciles against the latest upstream GitHub release. Chunks are content-addressed (`key = ruvnet/<repo>/<sha256-12>`), so only new/changed text is re-embedded, unchanged rows get a metadata version bump, vanished rows are pruned, and a `ruvnet/manifest` row stamps the corpus version (+ best-effort ADR-013 `urn:agentbox:dataset` URN). Manual: `./agentbox.sh ruvnet-brain <ingest [--force]|status|logs>`.

**MCP surface**: `mcp/ruvnet-brain/server.js` is a THIN wrapper (deps: MCP SDK + pg) exposing `search_ruvnet` (namespace-scoped pgvector search, optional repo filter, ILIKE fallback when Xinference is down) and `ruvnet_brain_status`. The same data is reachable via `mcp__claude-flow__memory_search({namespace: "ruvnet-kb"})` — no wrapper required.

**Write protection**: the entrypoint appends `ruvnet-kb` to `RUVECTOR_PROTECTED_NAMESPACES` on the claude-flow MCP env, so agents cannot overwrite reference corpus rows through `memory_store`; only the ingest playbook (direct pg, `source_type = ruvnet-brain-ingest`) writes there.

**Manifest gate**: `[skills.ruvnet_brain]` in `agentbox.toml` — `enabled`, `namespace`, `auto_ingest`, `grounding_hook`, `kb_release_url`, `staging_path` (workspace-backed transient download/extract scratch), `embed_batch`.

**Grounding hook**: `config/hooks/ruvnet-brain-ground.cjs` on `UserPromptSubmit` — detects RuvNet ecosystem mentions and classical-substitute anti-patterns (Pinecone, LangChain, ChromaDB, hnswlib, etc), injects a search-first directive. **Skill file**: `skills/ruvnet-brain/SKILL.md` — grounding rules, covered repos, anti-pattern matrix.

## System Surface & Events Chain (ADR-039)

`GET /v1/system` (authed) renders the live gate map: core spine (resolved adapter slots), surfaces, and modules, each with introspected `on|off|available` state and a fixed **apply-class** — `live` (read at op time), `boot` (next restart; entrypoint reconciles every boot), `rebuild` (Nix image; `./agentbox.sh rebuild`). The catalogue is documentation-as-data in `management-api/lib/system-manifest.js`: **when adding a manifest gate, add a catalogue entry with an honest apply class.** The events adapter's JSONL log is hash-chained (`seq`/`prev_hash`/`hash`, SHA-256 over deep-key-sorted canonical JSON); verify via `GET /v1/system/audit-chain`. Chain fields are implementation content — the events slot contract is unchanged. Patterns back-ported from DreamLab-AI/docBox (ADR-039 records what was ported, improved, and rejected).

## Model Routing (ADR-041)

`[model_routing]` in `agentbox.toml` is the single per-activity Claude/Codex routing policy (12 activities, `"host:model [-> host:model]"` grammar; Claude leads reasoning/review, Codex leads execution — defaults grounded in upstream `@claude-flow/codex` CollaborationTemplates). The current Claude lineup is Sonnet 5 for routine specification/review/release, Opus 5 for design and test escalation, and Fable 5.1 for long-horizon architecture, implementation escalation, security analysis, and debugging. The entrypoint projects it **every boot** (apply class `boot`): `agentbox-manifest model-routing-project` reconciles `agentOverrides` + `defaultProvider` + `fallbackChain` into every `.agentic-qe/llm-config.json` under the workspace (agentic-qe ≥ 3.13.1, issue #568; atomic writes, non-managed keys preserved, keys never persisted, fail-open), and `AQE_LLM_PROVIDER` onto the aqe MCP env. Those JSON files are managed artefacts — edit the manifest, not the JSON. `dual_run` stays `false` until upstream unpins `CLAUDE_FLOW_DB_PATH` from local SQLite (ruflo #2766, conflicts with ADR-015). Escalation rungs prefer the cross-vendor hop (ADR-011 anti-fox). Companion hygiene from the same adoption sweep (pattern source: pacphi/agentic-kit, MIT): `skills/token-audit/` (usage audit over local transcripts), `scripts/ruflo-daemon-gc.py` (pid-reuse-guarded reap), `scripts/npx-stale-scan.sh`, the aidefence closure probe in `lib/npm-cli.nix`, and the `RUFLO_DAEMON_AI_WORKERS=0` runtime-env pin.

## Consultant Tier (Z.AI / GLM)

`glm-5.3` is Z.AI's current flagship coding model and the one used everywhere in this repo (`consultants.zai.model`, `project_tracking.primer_model`, `[sovereign_mesh.mobile_bridge].summary_model`). All Z.AI traffic rides the GLM Coding Plan subscription endpoints — `api.z.ai/api/anthropic` (Anthropic Messages protocol: dream-engine `call_zai`, claude-zai wrapper) or `api.z.ai/api/coding/paas/v4` (OpenAI-protocol tools) — never the per-token general API at `api.z.ai/api/paas/v4`. GLM-5.3 always reasons (thinking cannot be disabled); responses carry a `thinking` block before `text`, so callers must budget `max_tokens` well above the reasoning overhead (≥1536; dream-engine uses 16384). `[consultants.zai].reasoning_effort` (`low | medium | high`) is wired end-to-end for deep thinking: manifest → `agentbox-manifest provision-stacks` exports `AGENTBOX_ZAI_REASONING_EFFORT` → `skills/mcp.json` consultant-zai env passthrough → `zai/server.js` maps it to Claude Code's `MAX_THINKING_TOKENS` (`low`=4096, `medium`=10000, `high`=31999) → the Z.AI Anthropic-compatible endpoint translates the thinking block into GLM `reasoning_effort`. Unset falls back to the endpoint default. ZCode (`zcode.z.ai`) is Z.AI's own desktop/web IDE, not a CLI — it does not replace the `claude-zai` wrapper harness and should not be documented as an integration path.

## Project Tracking

(PRD-017, ADR-035, DDD-015). Helm-grade project tracking re-expressed on the three sovereign substrates — no new URN kind, no new port, no new adapter slot. Each workspace/host-mount git repo found under `[project_tracking].scan_dirs` becomes a first-class:

- TrackedProject → `urn:agentbox:thing:<scope>:project-<sha256-12>` (content-addressed)
- ProjectScan → `urn:agentbox:activity:<scope>:projscan-<sha256-12>` (PROV-O receipt)
- CommitWindow → `urn:agentbox:dataset:<scope>:commits-<projsha>-30d`
- ProjectPrimer / ProjectSynopsis → `urn:agentbox:memory:<scope>:primer|synopsis-<sha256-12>`
- TrackingDigest → `urn:agentbox:event:<scope>:projtrack-<sha256-12>`

All minted through `management-api/lib/uris.js`. Three surfaces:

1. **Port-bound telemetry** — `management-api/observability/project-metrics.js` registers ten `agentbox_project_*` series on the shared Prometheus registry, so they appear on the existing `/metrics` (9090 + 9091). Labels carry the project **slug**, never the host path (privacy invariant).
2. **HTTP** — `management-api/routes/projects.js` at `/v1/projects` (list/detail/activity/scan/primer/publish); self-gates `503` when `[project_tracking].enabled` is not true; JSON-LD when `[linked_data]` is on.
3. **Custom-kind nostr** — **kind-30841** addressable project digest (NIP-33, `d`-tag = project slug), signed by the agent key and dual-written to pod + relay by `services/nostr-pod-bridge` (`track` subcommand), driven by `config/hooks/project-tracking-publish.cjs`. Sibling of kind-30840; communicates per-project status to the operator's `did:nostr`. Added to `[sovereign_mesh.relay].allowed_kinds`.

Durable state rides the existing **memory** (primers) and **events** (scans) adapter slots — never a new slot. Primers and GitHub enrichment are the only external hops and are independently gated. Disabled by default. Project tracking is the sixth participant in the `did:nostr` identity mesh.

## Voice Plane (tab0-bridge + Unmute loop + AoE operator console)

Fully local voice control of the agent plane, re-homed into **`agentbox/voice/`**
and re-imagined as a single first-class **operator cockpit** — the voice loop and
the AoE session board as co-equals, not a voice strip beside a log (Decision D0 /
ADR-044). It lives in agentbox because everything it wires — tab0-bridge, the AoE
plane, the NIP-98 proxy, management-api governance — is agentbox's. The Kyutai
Unmute fork stays an external build context (`voice-stack/unmute` clone, 26 GB,
not vendored). Three cooperating parts, one conversation surface:

- **tab0-bridge** (`config/tab0-bridge/`, canonical; auto-deployed to
  `~/workspace/tab0-bridge` and kept alive by fleet-session-start.sh →
  deploy.sh on every SessionStart, port 8971; turn-sink hooks registered by
  the entrypoint) — the single conversation/event hub.
  OpenAI-compatible `/v1/chat/completions` backs the voice loop with headless
  `claude -p` (subscription OAuth — the empty `ANTHROPIC_API_KEY` must be
  deleted from child envs or credential resolution breaks); `/hook/turn` sinks
  Claude Code Stop/UserPromptSubmit hooks; `/feed` (WS) + `/turns` serve the
  live transcript; `/tab0/send` is the only key-sending path (window 0 only);
  `/tabs/:n` are read-only pane captures; `/nostr/{status,events,send}`
  expose the Nostr plane to the browser console.
- **Kyutai Unmute stack** (external `voice-stack/unmute` clone, forked frontend +
  backend, STT/TTS on local GPU; layered via `voice/unmute-override.yml`) — the
  speech loop. Its "LLM" is the bridge, and it now carries `BRIDGE_TOKEN` as
  `KYUTAI_LLM_API_KEY` so the bridge's global auth (security finding 1) admits
  its `/v1/chat/completions` calls. The stock long-silence nudge is disabled
  (`UNMUTE_USER_SILENCE_TIMEOUT=0`) and the bridge additionally short-circuits
  `"..."` silence markers: the meta-controller is quiet unless called upon.
- **Operator console** (`voice/console/`, Caddy `docker-compose.voice.yml`, one
  self-signed TLS origin on :8444; :8443 = stock Unmute debug UI). ONE origin,
  ONE credential — a NIP-98 header signed via `window.nostr` (NIP-07) or a
  break-glass bearer, forwarded by Caddy to every upstream. Same-origin routes:
  `/embed` voice strip (forked Unmute frontend, no vendor branding) + `/api/*`
  (backend), `/feed`+`/bridge/*` (tab0-bridge), **`/aoe/*`** the AoE session
  board via the NIP-98 proxy (:9096 → :9095) rendered by our own client (AoE's
  dashboard sets `frame-ancestors 'none'`, so it can't be iframed), and
  **`/approvals/*`** governance (management-api :9090; Approve/Deny is
  operator-gated, finding 2). Voice targets ANY session, retargeted by click or
  spoken intent; injection goes bridge `/tab0/send` → the `tab0` coordinator.
- **Lifecycle**: `./agentbox.sh voice <up|down|logs|health|status|certs|rebuild|shell>`
  — a sidecar with its own lifecycle (like browsercontainer). `voice up`
  generates the self-signed cert (certs gitignored, never committed) and
  composes the Unmute clone's compose + `voice/unmute-override.yml` +
  `docker-compose.voice.yml` into one project. Manifest state: `[voice]` in
  `agentbox.toml` (apply-class sidecar). Full detail: `voice/README.md`.

The meta-controller never orchestrates: it relays spoken intents to the target
session, summarises what comes back, and reports others read-only. Loop safety:
gateway/mirror/nostr-send egress all carry client tags and are dropped on
re-ingress (see nostr-gateway header).
