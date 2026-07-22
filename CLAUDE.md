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
- **MCP memory is mandatory ruvector-postgres** ([ADR-015](docs/reference/adr/ADR-015-mcp-ruvector-mandate.md), amended 2026-07-04: embeddings are computed client-side via Xinference `bge-small-en-v1.5` (384-dim), not MiniLM/`generate_text_embedding()`): the `ruvector-mcp.cjs` server fails closed if PostgreSQL is unreachable — no silent sql.js fallback. The entrypoint generates `.mcp.json` at boot (gate + connection env reconciled every boot), auto-installs the `pg` module to the workspace bind mount, and de-registers any ungoverned ruvector-mcp fork (ADR-036 D2).
- **memory + learning surfaces are manifest-gated, and as of the v2 uplift (2026-07-21/22) the learning loop is CLOSED end-to-end for capture→distil** ([PRD-018](docs/reference/prd/PRD-018-ruvector-native-memory-and-learning.md) / [ADR-036](docs/reference/adr/ADR-036-ruvector-capability-adoption-and-learning-loop.md) / [DDD-016](docs/reference/ddd/DDD-016-memory-learning-domain.md) shipped the honest producer; [PRD-020](docs/reference/prd/PRD-020-ruvector-learning-consumers-and-corpus-uplift.md) / [ADR-040](docs/reference/adr/ADR-040-learning-consumers-model-lifecycle-and-legacy-mining.md) / [DDD-018](docs/reference/ddd/DDD-018-learning-consumers-and-model-lifecycle-domain.md) built the missing aggregator + consumers) — check `agentbox.toml` directly, it is the running configuration, not a template. All six `[integrations.ruvector_external]` retrieval gates (`hybrid_search`, `typed_metadata`, `metadata_gin`, `health_tool`, `episodic_ttl_sweep`, `memory_orient`) are `true`, so hybrid search, typed metadata/TTL, and `memory_health`/`memory_orient` are active. `[memory_learning]` is live and the loop now runs **trajectories → judgments → Wilson aggregates → distilled `patterns`**: the producer (`config/hooks/trajectory-recorder.cjs`) captured **405 trajectories / 8,806 steps, all judged**; the aggregator (`ruvector-aggregate-sweep.mjs`, gate `aggregate_sweep`, 30-min sweep) holds **12 aggregates past the Wilson floor from 8,839 steps** in `memory-learning-aggregates`; the distiller (`ruvector-pattern-distill.mjs`, gate `pattern_distillation`) wrote **13 `judge:trajectory` patterns, all embedded** — the `patterns` table's first machine-distilled rows. Only `feed_retrieval` / `feed_routing` remain the next gates (still `false`). The **recall-regression harness now exists** — `./agentbox.sh ruvector recall` (stratified fixture, median-of-3), THE gate for any retrieval-geometry change, with a **frozen band self ≥175/200 · true ≥107/120** (live post-rebuild 177/200 · 109/120); the audit-era **188/200 was a PRE-INGEST number and is NOT the current bar**. **Reindex ops law:** HNSW graphs degrade under write churn — after any bulk ingest/deletion, recall falls silently (live self-recall had dropped to 141/200 before it was caught) and is recovered only by a **non-concurrent** index rebuild (`m=16`, `ef_construction=128`, ~5 min; `ef_search` tuning did nothing); **NEVER `CREATE INDEX CONCURRENTLY` on the ruvector HNSW access method** — verified double-insertion (every tuple indexed twice). **SONA is inert at 384-dim** (the engine hardcodes `embedding_dim=256`; 384-dim learns return `status:learned` but accumulate nothing) — `sona_enabled` is split into `sona_learn_enabled` / `sona_apply_enabled` and both stay OFF until an image with configurable dim; **attention re-rank (`attention_rerank`) is OFF by measurement** (the corpus is exactly L2-normalised ⇒ `attention_score` = cos/√dim, max diff 4e-7 — a mathematical no-op, not caution). Embedding stays **bge-small-en-v1.5 / 384-dim** (a v2 A/B rejected Qwen3-0.6B/4B and bge-m3; never MiniLM). The ~2M legacy corpus is **gone from the live store** (PRD-018 exported 2,014,173 rows to an 11G cold archive, `VACUUM FULL` took `memory_entries` 34 GB → 614 MB; live store ~178,427 rows / 454 namespaces; the archive was audited in isolation and **nothing was imported**). Durable supervisord scheduling for the sweep/distill loops is **staged in flake.nix but not yet imaged** — until the next rebuild they run as operator-started detached loops. `[memory_hygiene]`'s three ops (`allow_namespace_repair`, `allow_embedding_backfill`, `allow_legacy_archival`) are `false` (fail-closed, re-sealed) — each ran its non-dry-run pass exactly once on 2026-07-05 (see CHANGELOG) and the gate was then closed again. Sidecar lifecycle (pin-by-digest updates, snapshot-rehearsed; hygiene ops dry-run unless their gate is open): `./agentbox.sh ruvector <status|check|test|update|rollback|recall|…>`.

Full product spec: [PRD-001](docs/reference/prd/PRD-001-capabilities-and-adapters.md). Adapter contract + SLOs + observability: [ADR-005](docs/reference/adr/ADR-005-pluggable-adapter-architecture.md).

## Canonical Runtime Files

- [`flake.nix`](flake.nix): image composition and generated supervisor text
- [`agentbox.toml`](agentbox.toml): feature gates and toolchains
- [`config/entrypoint-unified.sh`](config/entrypoint-unified.sh): runtime bootstrap (also performs runtime dependency bootstrap; the old `scripts/skills-entrypoint.sh` is retired)
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

Parallel namespace: the host project's Rust substrate uses the converged `urn:visionclaw:<kind>:...` grammar minted in `src/uri/` — 5 URN kinds plus `did:nostr` for identity. The kinds are *not* uniformly `<hex-pubkey>:<local>`; their shapes differ by kind:
- `concept:<domain>:<slug>` — domain-scoped (post-elevation shared ontology class)
- `kg:<hex-pubkey>:<sha256-12>` — owner-scoped, content-addressed (personal KG node)
- `bead:<hex-pubkey>:<sha256-12>` — owner-scoped, content-addressed
- `execution:<sha256-12>` — content-addressed, **unscoped** (owner travels in `owner_did`)
- `group:<team>#members` — team-scoped
- identity is `did:nostr:<hex-pubkey>` — there is **no** `urn:visionclaw:agent` kind; an agent's identity *is* its DID.

Owner-scoped kinds use the 64-char hex pubkey as scope (not bech32 npub). This grammar is converged across agentic worktrees but **not yet merged to VisionClaw main** (main still carries the legacy `urn:ngm:node/edge/domain` scheme). Until it merges, `management-api/lib/bc20-provenance-bridge.js` (+ its sovereign test) is the executable definition of the BC20 anti-corruption layer that maps between the two namespaces at the federation boundary (B05: the only cross-namespace importer).

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

**Manifest gate**: `[skills.ruvnet_brain]` in `agentbox.toml` — `enabled`, `namespace`, `auto_ingest`, `grounding_hook`, `kb_release_url`, `staging_path` (named volume `ruvnet-brain-data`, download/extract scratch only), `embed_batch`.

**Grounding hook**: `config/hooks/ruvnet-brain-ground.cjs` on `UserPromptSubmit` — detects RuvNet ecosystem mentions and classical-substitute anti-patterns (Pinecone, LangChain, ChromaDB, hnswlib, etc), injects a search-first directive. **Skill file**: `skills/ruvnet-brain/SKILL.md` — grounding rules, covered repos, anti-pattern matrix.

## System Surface & Events Chain (ADR-039)

`GET /v1/system` (authed) renders the live gate map: core spine (resolved adapter slots), surfaces, and modules, each with introspected `on|off|available` state and a fixed **apply-class** — `live` (read at op time), `boot` (next restart; entrypoint reconciles every boot), `rebuild` (Nix image; `./agentbox.sh rebuild`). The catalogue is documentation-as-data in `management-api/lib/system-manifest.js`: **when adding a manifest gate, add a catalogue entry with an honest apply class.** The events adapter's JSONL log is hash-chained (`seq`/`prev_hash`/`hash`, SHA-256 over deep-key-sorted canonical JSON); verify via `GET /v1/system/audit-chain`. Chain fields are implementation content — the events slot contract is unchanged. Patterns back-ported from DreamLab-AI/docBox (ADR-039 records what was ported, improved, and rejected).

## Consultant Tier (Z.AI / GLM)

`glm-5.2` (1M context) is Z.AI's flagship coding model and the one used everywhere in this repo (`consultants.zai.model`, `project_tracking.primer_model`, `[sovereign_mesh.mobile_bridge].summary_model`). `[consultants.zai].reasoning_effort` (`low | medium | high`) is wired end-to-end for deep thinking: manifest → `scripts/provision-agent-stacks.py` exports `AGENTBOX_ZAI_REASONING_EFFORT` → `skills/mcp.json` consultant-zai env passthrough → `zai/server.js` maps it to Claude Code's `MAX_THINKING_TOKENS` (`low`=4096, `medium`=10000, `high`=31999) → the Z.AI Anthropic-compatible endpoint (`api.z.ai/api/anthropic`) translates the thinking block into GLM `reasoning_effort`. Unset falls back to the endpoint default. ZCode (`zcode.z.ai`) is Z.AI's own desktop/web IDE, not a CLI — it does not replace the `claude-zai` wrapper harness and should not be documented as an integration path.

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

## Docs To Keep In Sync

When architecture changes, update these together:

- [`README.md`](README.md)
- [`docs/user/quickstart.md`](docs/user/quickstart.md)
- [`CLAUDE.md`](CLAUDE.md)
- [`browsercontainer/README.md`](browsercontainer/README.md)
- [`docs/developer/code-as-harness.md`](docs/developer/code-as-harness.md)
- [`docs/developer/ecosystem.md`](docs/developer/ecosystem.md)
- relevant ADRs in `docs/reference/adr/` (project tracking: [ADR-035](docs/reference/adr/ADR-035-project-tracking-telemetry-and-nostr-kind.md), [PRD-017](docs/reference/prd/PRD-017-sovereign-project-tracking.md), [DDD-015](docs/reference/ddd/DDD-015-project-tracking-domain.md))
