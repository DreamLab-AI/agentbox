# Agentbox — agent instructions

> Canonical, tool-neutral instructions for every coding agent (Claude Code, Codex, others). Claude-only affordances live in `CLAUDE.md`, which imports this file.

Agentbox is a standalone sovereign agent-container product (`github.com/DreamLab-AI/agentbox`): Nix-composed image, manifest-gated features, pluggable durable-state adapters, sovereign identity (`did:nostr`). Only undiscoverable constraints live here.

**Ground truth:** living governing docs in `docs/` (BASELINE-container, INGRESS-identity, LEARNING-memory, GOVERNANCE-capabilities; their *Invariants* are the compliance surface) + the `docs/adr/` ledger. `docs/archive/` is rationale, never authority. Routing: `docs/adr/README.md`.

## Architecture in one paragraph

`agentbox.toml` is the *running* configuration, not a template — check it directly. Runtime is profile-based (tmux + fish). The **interaction plane is Agent of Empires** (PRD-021/ADR-042): `aoe serve` on loopback `:9095` behind the sole-ingress NIP-98 proxy `:9096`; each session binds a `did:nostr` + URN + beads epic + scoped memory namespace (ADR-043). Durable state goes through five adapter slots (beads, pods, memory, events, orchestrator; ADR-005), each resolving to `local-*`, `external` or `off`; `federation.mode` selects standalone vs client.

## RuVector — repo-specific rules

Generic rules (MCP-only access, bge-small 384-dim, HNSW index law, no `CREATE INDEX CONCURRENTLY`) live in the workspace `CLAUDE.md`.

```
store      = ruvector-postgres sidecar is mandatory (ADR-015); ruvector-mcp.cjs fails closed, no sql.js fallback
orchestr.  = the SAME claude-flow server forwards [integrations.ruvector_external].orchestration_tools to one
             filtered `ruflo mcp start` child per session (ADR-2082); memory_* denied proxy-side, fail-open to
             honest stubs — never register ruflo as a second MCP server
recall-gate= ./agentbox.sh ruvector recall — REQUIRED before/after any retrieval-geometry change;
             ENFORCED floor self ≥175/200, true ≥102/120 (107 is the target; 188/200 is a pre-ingest number)
sona       = OFF (inert at 384-dim in @ruvector/sona@0.1.5); attention_rerank = OFF (measured no-op)
protected  = ruvnet-kb namespace (reference corpus, ingest-only writes)
lifecycle  = ./agentbox.sh ruvector <status|check|test|update|rollback|recall>
```

## Agents, skills, commands — manifest-registered

- **Agents** (ADR-2092): write `agents/<name>.md`, add the basename to `agents/registered-agents.txt`, rebuild; gate `bash tests/config/agent-reconcile.test.sh`. Commands: `config/registered-commands.txt`.
- **Skills**: the image bakes `/opt/agentbox/skills` (127 skills); only `skills/registered-skills.txt` is always loaded (Codex: `codex-registered-skills.txt`). Depth goes in `references/`, never a monolith SKILL.md. A new skill needs a `section-map.json` entry and a `SKILL-DIRECTORY.md` row; `skills/lint-skills.sh` must pass before a rebuild.
- **Never write a `/nix/store/...` path into persistent config** (`.mcp.json`, `~/.claude` outlive the store). Pin `/opt/agentbox/bin/<tool>` and make registration self-healing (compare, don't `grep -q`).

Narrative, Jev compaction (ADR-2093) and live skill routing (ADR-2091): [runtime-files.md](docs/reference/claude-context/runtime-files.md).

## Canonical runtime files

| Path | Purpose |
|---|---|
| [`flake.nix`](flake.nix) | image composition, generated supervisor text |
| [`agentbox.toml`](agentbox.toml) | feature gates, toolchains; `[vault]` is the single corpus path authority (ADR-2028; writes via `vault propose`/`vault edit --expect`, ADR-2107) |
| [`config/entrypoint-unified.sh`](config/entrypoint-unified.sh) | boot reconciliation of `.mcp.json`, hooks, model routing |
| [`services/agentbox-manifest`](services/agentbox-manifest) | Rust boot projector for every manifest read (python3 is not a boot dependency) |
| [`services/nostr-pod-bridge`](services/nostr-pod-bridge) | sovereign identity bootstrap, relay slot, session digests |
| [`config/nip98-proxy/`](config/nip98-proxy/) | sole NIP-98 ingress `:9096` (AoE, `/mgmt/`) |
| [`config/hooks/`](config/hooks/) | hooks and non-hook helpers — read its `CLAUDE.md` first |
| [`config/model-router/`](config/model-router/) | ADR-2080 router console; `AGENTBOX_MODEL_ROUTER_*` only |
| [`crates/colloquy/`](crates/colloquy/) | cq learning model — has its own `AGENTS.md` |
| [`DreamLab-AI/sidestr-rs`](https://github.com/DreamLab-AI/sidestr-rs) | sidestr crates, **not in this repo** (ADR-2112); `AGPL-3.0-only`, consumed from crates.io and never a dependency of a permissive crate. This repo hosts only the chain instance: [`config/sidechain/`](config/sidechain/) |

Everything else (tab0-bridge, voice, harness-wrappers, AoE seeder, explainer-tools): [runtime-files.md](docs/reference/claude-context/runtime-files.md).

## URI/URN scheme

`urn:agentbox:<kind>:[<scope>:]<local>` (scope = 64-char hex pubkey), 20 kinds; identity `did:nostr:<hex-pubkey>`; content addressing `sha256-12-<12hex>`. **All durable identifiers are minted through `management-api/lib/uris.js`** — ad-hoc `format!()`/template-literal URNs are prohibited. Ref: ADR-013; host bridge: [subsystem-notes §URI](docs/reference/claude-context/subsystem-notes.md).

## Rules for changes

- Optional features are gated in `agentbox.toml` — gate both the Nix package set and the supervisor block, and add a `system-manifest.js` entry with an honest apply class (`live`/`boot`/`rebuild`, ADR-039).
- Every durable-state integration rides one of the five slots; `tests/contract/` must pass for all three implementation classes per slot. Never a client-only or standalone-only feature.
- Adapter dispatch middleware, in order: observability (ADR-005) → privacy filter (ADR-008) → JSON-LD encoder (ADR-012). New cross-cutting concerns follow that shape, fail-open/closed explicit in an ADR.
- Linked-Data surfaces are opt-in (`[linked_data]`); contexts are build-pinned (`lib/linked-data-contexts.nix`), never fetched at runtime; every `@id` is minted via `uris.js`.
- The sovereign data stack (solid-pod-rs, nostr relay + pod-inbox bridge, identity layer, privacy filter) shares one identity and one source of truth — weigh changes across all four layers (DDD-003 I01–I12).
- No host-project specifics in this repo — reference the host by role, not name.
- Every adapter dispatch emits span + log + metrics; only exporters are optional.
- Never reintroduce Linux pseudo-user isolation as the primary model.

## Runtime model gotchas

- Deploy with `./agentbox.sh rebuild` (`--no-cleanup` keeps recovery images). It loads `docker-compose.override.yml` (workspace volume, project mounts, `.env`); a base-only `docker compose -f docker-compose.yml` exposes an unrelated workspace bind — never do that; inspect mounts after deploy.
- `HOME=/home/devuser`; workspace `/home/devuser/workspace` (`$WORKSPACE`). The literal `/workspace` is retired and will break.
- Supervisord runs as PID 1 root; every long-running program drops to `user=devuser`. Docs describing `gemini-user`/`openai-user` pseudo-users are legacy.
- AoE sessions persist on the `aoe-profiles` volume; the seeder reaps only its own clean orphan worktrees (ADR-2063). Hub-routed MCP servers refusing connections → `supervisorctl status agentbox-mcp-hub` first (it parks FATAL after 120 s without `/run/agentbox/mcp-hub.json`, ADR-2104).
- Pods requests are unsigned (`sign_requests = false`, ADR-2064) until ADR-2078 wires the identity key; flipping it without key material throws `SigningUnavailable`.
- Claude Fable 5.1 uses always-on adaptive thinking: keep API histories append-only, replay thinking blocks exactly, do not force tool choice.

## Subsystem references (load on demand)

`docs/reference/claude-context/`: [ruvector-memory-state](docs/reference/claude-context/ruvector-memory-state.md) · [subsystem-notes](docs/reference/claude-context/subsystem-notes.md) (browser, code-as-harness, RuvNet Brain, `/v1/system`, model routing, consultants, project tracking, voice) · [runtime-files](docs/reference/claude-context/runtime-files.md) · [crates](docs/reference/claude-context/crates.md).

## Docs to keep in sync

When architecture changes, update together: `README.md`, `docs/user/quickstart.md`, this file (and `CLAUDE.md` for Claude-only notes), `browsercontainer/README.md`, `docs/developer/code-as-harness.md`, `docs/developer/ecosystem.md`, `docs/reference/claude-context/`, the living ground-truth docs in `docs/`, and a thin decision record in `docs/adr/`.
