# Agentbox Repo Notes

Agentbox is a standalone sovereign agent-container product (`github.com/DreamLab-AI/agentbox`): Nix-composed image, manifest-gated features, pluggable durable-state adapters, sovereign identity (`did:nostr`). This file holds the constraints and gotchas you can't discover from the file system; deep subsystem state lives in the linked references.

**Architecture ground truth (consolidated 2026-08-31):** the ADR pack for any domain = its living governing document in `docs/` (BASELINE-container, INGRESS-identity, LEARNING-memory, GOVERNANCE-capabilities — their *Invariants* are the compliance surface) + the `docs/adr/` ledger records amending it. `docs/archive/` is rationale/history only, never authority. Routing table + decision process: `docs/adr/README.md`.

## Architecture in one paragraph

`agentbox.toml` drives build composition and is the *running* configuration, not a template — check it directly. Runtime is profile-based (tmux + fish); profile isolation replaced Linux pseudo-user isolation. The **interaction plane is Agent of Empires** (`[interaction_plane]` gate, PRD-021/ADR-042): `aoe serve` on loopback `:9095` behind a sole-ingress NIP-98 proxy (`:9096`) owns interactive-session lifecycle, superseding the MAD-style per-provider harness tabs in place — each session binds a `did:nostr` + URN + beads epic + scoped memory namespace at create (ADR-043). Durable state goes through five adapter slots (beads, pods, memory, events, orchestrator; [ADR-005](docs/archive/adr/ADR-005-pluggable-adapter-architecture.md)), each resolving to `local-*`, `external`, or `off`; `federation.mode` selects standalone vs client. Full spec: [PRD-001](docs/archive/prd/PRD-001-capabilities-and-adapters.md).

## RuVector memory — operative rules

```
store      = ruvector-postgres sidecar (mandatory, ADR-015; ruvector-mcp.cjs fails closed, no sql.js fallback)
access     = mcp__claude-flow__memory_* ONLY (CLI + raw SQL bypass the embedding pipeline → rows invisible to HNSW)
embedding  = bge-small-en-v1.5 via Xinference, 384-dim, client-side (never MiniLM; A/B rejected bge-m3, Qwen3)
index-law  = HNSW degrades silently under bulk churn → non-concurrent rebuild (m=16, ef_construction=128, ~5min)
FORBIDDEN  = CREATE INDEX CONCURRENTLY on ruvector HNSW AM (verified double-insertion)
recall-gate= ./agentbox.sh ruvector recall — REQUIRED before/after any retrieval-geometry change
             frozen band: self ≥175/200, true ≥107/120 (188/200 is a pre-ingest number, not the bar)
sona       = OFF (inert at 384-dim in @ruvector/sona@0.1.5 binary); attention_rerank = OFF (measured no-op)
protected  = ruvnet-kb namespace (reference corpus, ingest-only writes)
lifecycle  = ./agentbox.sh ruvector <status|check|test|update|rollback|recall>
```

Full audited state (learning loop, gates, corpus history): [ruvector-memory-state](docs/reference/claude-context/ruvector-memory-state.md).

## Skills — progressive discovery

The image bakes `/opt/agentbox/skills` (118 skills). Skills are the JIT context layer: trigger-led descriptions route, `references/` subdirs hold depth loaded on demand — keep it that way when adding or editing skills (no monolith SKILL.md; relocate depth to `references/`, never cull; skill docs use skill-relative paths, never `~/.claude/skills/<name>/`). Gate: `skills/lint-skills.sh` must pass before a rebuild. Directory + routing: [skills/SKILL-DIRECTORY.md](skills/SKILL-DIRECTORY.md); historical upgrade rationale: [docs/archive/skills-upgrade-plan-c5.md](docs/archive/skills-upgrade-plan-c5.md).

## Canonical runtime files

- [`flake.nix`](flake.nix): image composition and generated supervisor text
- [`agentbox.toml`](agentbox.toml): feature gates and toolchains
- [`config/entrypoint-unified.sh`](config/entrypoint-unified.sh): runtime bootstrap (boot-time reconciliation of .mcp.json, hooks, model routing)
- [`scripts/sovereign-bootstrap.py`](scripts/sovereign-bootstrap.py): identity generation and pod scaffolding
- [`scripts/provision-agent-stacks.py`](scripts/provision-agent-stacks.py): stack/profile provisioning
- [`config/tmux-autostart.sh`](config/tmux-autostart.sh) / [`config/tmux.conf`](config/tmux.conf): tmux session layer
- [`config/tab0-bridge/`](config/tab0-bridge/): voice/nostr meta-controller for tmux window 0 — canonical source; deploys to `~/workspace/tab0-bridge` (see its README)
- [`voice/`](voice/): voice + AoE operator console (ADR-044) — Caddy origin (:8444), console site, `unmute-override.yml`; lifecycle `./agentbox.sh voice`, compose `docker-compose.voice.yml` (see [`voice/README.md`](voice/README.md))
- [`config/nip98-proxy/`](config/nip98-proxy/): sole NIP-98-verifying ingress to the AoE serve loopback port, and the multi-upstream sovereign ingress — LAN-published `:9096`, `/mgmt/` → management-api (PRD-021 WS4/ADR-043 D4.6/ADR-045); overlaid to `/opt/agentbox/nip98-proxy`, supervised as `[program:nip98-proxy]`
- [`config/harness-wrappers/`](config/harness-wrappers/): `agent_command_override` wrappers (openrouter/zai) that pin profile isolation + assert the `ANTHROPIC_BASE_URL` redirect and hard-fail loudly on mis-billing (PRD-021 F2-4/N-01)
- [`scripts/aoe-seed-sessions.mjs`](scripts/aoe-seed-sessions.mjs): reconciler that provisions `[[interaction_plane.session_seeds]]` as AoE sessions and binds each session boundary's identity (PRD-021 WS2/WS3)

## URI/URN scheme

`urn:agentbox:<kind>:[<scope>:]<local>` (scope = 64-char hex pubkey), 19 kinds (`decision` added by ADR-048); identity `did:nostr:<hex-pubkey>`; content addressing `sha256-12-<12hex>`. **All durable identifiers are minted through `management-api/lib/uris.js`** — ad-hoc `format!()`/template-literal URNs are prohibited. Resolvability best-effort via `/v1/uri/<urn>` (307/404/410). Ref: [ADR-013](docs/archive/adr/ADR-013-canonical-uri-grammar.md). The host project's parallel `urn:visionclaw:*` grammar and the BC20 anti-corruption bridge: [subsystem-notes §URI](docs/reference/claude-context/subsystem-notes.md).

## Rules for changes

- Optional features are manifest-gated through `agentbox.toml` — gate both the Nix package set and the supervisor block. When adding a gate, add a `system-manifest.js` catalogue entry with an honest apply class (`live`/`boot`/`rebuild`, ADR-039).
- Adapter contract is non-negotiable: every durable-state integration rides one of the five slots; `tests/contract/` must pass for all three implementation classes per slot. Never a client-only or standalone-only feature.
- Three middleware layers wrap every adapter dispatch, in order: observability (ADR-005) → privacy filter (ADR-008) → JSON-LD encoder (ADR-012). New cross-cutting concerns follow that shape, with fail-open/fail-closed explicit in an ADR.
- Linked-Data surfaces are opt-in per surface (`[linked_data]`); context documents are build-pinned via `lib/linked-data-contexts.nix`, never fetched at runtime.
- Every emitted `@id` follows ADR-013 and is minted via `uris.js`; surfaces never invent ad-hoc IDs.
- The sovereign data stack (solid-pod-rs, nostr relay + pod-inbox bridge, identity layer, privacy filter) shares one identity and one source of truth — weigh changes across all four layers (DDD-003 I01–I12).
- No host-project specifics in this repo — reference the host by role, not name.
- Observability is built-in: every adapter dispatch emits span + log + metrics; only exporters are optional.
- Do not reintroduce Linux pseudo-user isolation as the primary model.

## Runtime model gotchas

- `HOME=/home/devuser`; workspace at `/home/devuser/workspace` (`$WORKSPACE`). The literal path `/workspace` is retired and will break.
- Supervisord runs as PID 1 root; every long-running program drops to `user=devuser`. No agent-facing process runs as root after bootstrap.
- Older docs describing `gemini-user`/`openai-user`/etc pseudo-users are legacy, not the runtime path.
- Claude Fable 5.1 uses always-on adaptive thinking. Keep multi-turn API histories append-only and replay thinking blocks exactly as returned; do not force tool choice. In agent prompts, request concise progress updates during long tool loops, permit batching independent tool calls, require completion without re-asking for already-authorised steps, and prefer targeted edits over whole-file rewrites.

## Subsystem references (load on demand)

| Subsystem | Where |
|---|---|
| RuVector memory + learning loop state | [claude-context/ruvector-memory-state.md](docs/reference/claude-context/ruvector-memory-state.md) |
| Browser container (GPU Chrome, CDP, MCP SSE) | [subsystem-notes §Browser](docs/reference/claude-context/subsystem-notes.md) + [browsercontainer/README.md](browsercontainer/README.md) |
| Code-as-harness URN allocation, aci-shell | [subsystem-notes §Code-as-Harness](docs/reference/claude-context/subsystem-notes.md) |
| RuvNet Brain KB (`ruvnet-kb`, ingest, grounding hook) | [subsystem-notes §RuvNet Brain](docs/reference/claude-context/subsystem-notes.md) |
| System surface `/v1/system`, hash-chained events | [subsystem-notes §System Surface](docs/reference/claude-context/subsystem-notes.md) |
| Model routing (Claude/Codex per-activity) | [subsystem-notes §Model Routing](docs/reference/claude-context/subsystem-notes.md) |
| Consultant tier (Z.AI glm-5.3, reasoning_effort wiring) | [subsystem-notes §Consultant Tier](docs/reference/claude-context/subsystem-notes.md) |
| Project tracking (kind-30841, telemetry, /v1/projects) | [subsystem-notes §Project Tracking](docs/reference/claude-context/subsystem-notes.md) |
| Voice + AoE operator console (Caddy :8444, tab0-bridge :8971, Unmute loop) | [voice/README.md](voice/README.md) + [subsystem-notes §Voice Plane](docs/reference/claude-context/subsystem-notes.md) + [config/tab0-bridge/README.md](config/tab0-bridge/README.md) |
| Security audit sprint 2026-05-11 (7 fixes) | CHANGELOG.md `[Security Audit Sprint] - 2026-05-11` |

## Docs to keep in sync

When architecture changes, update together: [`README.md`](README.md), [`docs/user/quickstart.md`](docs/user/quickstart.md), [`CLAUDE.md`](CLAUDE.md), [`browsercontainer/README.md`](browsercontainer/README.md), [`docs/developer/code-as-harness.md`](docs/developer/code-as-harness.md), [`docs/developer/ecosystem.md`](docs/developer/ecosystem.md), the living ground-truth docs in `docs/` (BASELINE-container, INGRESS-identity, LEARNING-memory, GOVERNANCE-capabilities), and a thin decision record in `docs/adr/` (template + generated index; legacy corpus frozen at `docs/archive/`).
