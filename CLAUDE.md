# Agentbox Repo Notes

Agentbox is a standalone sovereign agent-container product (`github.com/DreamLab-AI/agentbox`): Nix-composed image, manifest-gated features, pluggable durable-state adapters, sovereign identity (`did:nostr`). This file holds the constraints and gotchas you can't discover from the file system; deep subsystem state lives in the linked references.

**Architecture ground truth (consolidated 2026-08-31):** the ADR pack for any domain = its living governing document in `docs/` (BASELINE-container, INGRESS-identity, LEARNING-memory, GOVERNANCE-capabilities — their *Invariants* are the compliance surface) + the `docs/adr/` ledger records amending it. `docs/archive/` is rationale/history only, never authority. Routing table + decision process: `docs/adr/README.md`.

## Architecture in one paragraph

`agentbox.toml` drives build composition and is the *running* configuration, not a template — check it directly. Runtime is profile-based (tmux + fish); profile isolation replaced Linux pseudo-user isolation. The **interaction plane is Agent of Empires** (`[interaction_plane]` gate, PRD-021/ADR-042): `aoe serve` on loopback `:9095` behind a sole-ingress NIP-98 proxy (`:9096`) owns interactive-session lifecycle, superseding the MAD-style per-provider harness tabs in place — each session binds a `did:nostr` + URN + beads epic + scoped memory namespace at create (ADR-043). Durable state goes through five adapter slots (beads, pods, memory, events, orchestrator; [ADR-005](docs/archive/adr/ADR-005-pluggable-adapter-architecture.md)), each resolving to `local-*`, `external`, or `off`; `federation.mode` selects standalone vs client. Full spec: [PRD-001](docs/archive/prd/PRD-001-capabilities-and-adapters.md).

## RuVector memory — operative rules

```
store      = ruvector-postgres sidecar (mandatory, ADR-015; ruvector-mcp.cjs fails closed, no sql.js fallback)
access     = mcp__claude-flow__memory_* ONLY (CLI + raw SQL bypass the embedding pipeline → rows invisible to HNSW)
orchestr.  = the SAME claude-flow server forwards swarm/agent/task/coordination tools to one filtered `ruflo mcp start`
             child per session (ADR-2082, gate [integrations.ruvector_external].orchestration_proxy); memory_* is denied
             on the proxy side, fail-open to honest stubs — never register ruflo as a second MCP server
embedding  = bge-small-en-v1.5 via Xinference, 384-dim, client-side (never MiniLM; A/B rejected bge-m3, Qwen3)
index-law  = HNSW degrades silently under bulk churn → non-concurrent AND serial HNSW rebuild (m=16, ef_construction=128, max_parallel_maintenance_workers=0, ~8 min); the parallel build (16 workers) leaves ~20% of rows unreachable (self-recall 151/200 vs 189/200 serial, measured 2026-09-05)
FORBIDDEN  = CREATE INDEX CONCURRENTLY on ruvector HNSW AM (verified double-insertion)
recall-gate= ./agentbox.sh ruvector recall — REQUIRED before/after any retrieval-geometry change
             frozen band: self ≥175/200, true ≥107/120 target; the ENFORCED floor is true ≥102/120
             (188/200 is a pre-ingest number, not the bar)
sona       = OFF (inert at 384-dim in @ruvector/sona@0.1.5 binary); attention_rerank = OFF (measured no-op)
protected  = ruvnet-kb namespace (reference corpus, ingest-only writes)
lifecycle  = ./agentbox.sh ruvector <status|check|test|update|rollback|recall>
```

Full audited state (learning loop, gates, corpus history): [ruvector-memory-state](docs/reference/claude-context/ruvector-memory-state.md).

## Agents & commands — manifest-governed (ADR-2092)

The image bakes `/opt/agentbox/agents` (12 subagents) and registers them from
`agents/registered-agents.txt`; `scripts/reconcile-agents.sh` projects that set into
`~/.claude/agents` at boot, retires vendor dumps to a recoverable `.superseded/` sidecar,
and collapses `$WORKSPACE/.claude/agents` + `$WORKSPACE/project/.claude/agents` so the
visible set never depends on the launch CWD. Same model as the skills manifest below, and
added for the same reason: nothing governed the agent roots, so `ruflo init`
(`@claude-flow/cli`) and `aqe init --auto` accreted **97 agents across two roots** on a
host mount that survives every rebuild — 74 present in both, 37 byte-divergent, and the
nested root *shadows* the user root, so the older truncated copy was the one being served.
Slash-commands get the prune-only sibling (`config/registered-commands.txt` +
`scripts/reconcile-commands.sh`, 244 → `dream.md` alone).

**To add an agent:** write `agents/<name>.md`, add the basename to
`agents/registered-agents.txt`, rebuild. Registration is a repo change by design — the old
cost of adding one was zero, which is how 97 accumulated. A hand-written agent dropped flat
into `~/.claude/agents` with no vendor marker is preserved and reported, so experiments
still work. Gate: `bash tests/config/agent-reconcile.test.sh` (26 assertions) before a
rebuild.

**Never write a `/nix/store/...` path into persistent config.** Store paths are
content-addressed and change every rebuild; `.mcp.json` and `~/.claude` are host mounts that
outlive them. Pin `/opt/agentbox/bin/<tool>` (baked in `flake.nix` as a symlink) and make the
registration self-healing — compare the recorded value against the canonical one rather than
guarding with `grep -q '"name"'`, which registers once and can never correct a stale entry.
Both mistakes together are what left the colloquy MCP server failing `ENOENT` against a
garbage-collected store path while the container looked healthy.

## Skills — progressive discovery

The image bakes `/opt/agentbox/skills` (127 skills). Skills are the JIT context layer: trigger-led descriptions route, `references/` subdirs hold depth loaded on demand — keep it that way when adding or editing skills (no monolith SKILL.md; relocate depth to `references/` rather than deleting it; skill docs use skill-relative paths, never `~/.claude/skills/<name>/`). A whole skill may be **removed** when measurement plus an operator decision support it (ADR-2089; first applied 2026-09-16 to four tooling-free thinking lenses) — that is a deliberate, git-recoverable act, not a licence to trim depth out of a skill that stays. One authoring contract (ADR-2083, taught by `skills/skill-builder`): `name` equals the directory, `description` ≤ 1024 chars with what/when/when-not, Claude-only affordances stated in one line with the Codex fallback. Discovery is generated: `skills/gen-routing-table.mjs` + `skill-router/references/section-map.json` produce the router table; a new skill needs a section-map entry and a `SKILL-DIRECTORY.md` row. Registration is by manifest — `skills/registered-skills.txt` (Claude Code, always-loaded) and `skills/codex-registered-skills.txt` (Codex / GPT-6 Astra) — reconciled into `~/.claude/skills` and `~/.codex/skills` at boot. Compaction is Jev-judged by default (ADR-2093): `[features.jev_compaction]` installs the function-hook plugin `config/claude-plugins/jev-compaction` (Claude Code ≥ 2.1.274), which drops or truncates only the tool calls Jev says are stale and never rewrites text; **email-tainted sessions always get the built-in summary**, `/jev-compact on|off|status` is the switch, and any failure falls open to the built-in compaction. Routing is live by default (ADR-2091): `[skills.routing].router = "jev"` registers `config/hooks/skill-route.cjs` on `UserPromptSubmit`, one System One Choice over every routable description per turn injected as advisory context, and `/route` shares its library; it fails open to `"table"` (the always-loaded descriptions + `routing-table.md`, the pre-2091 path) on any failure — never treat the pick's probability as a gate (ADR-2090). Gate: `skills/lint-skills.sh` must pass before a rebuild. Directory + routing: [skills/SKILL-DIRECTORY.md](skills/SKILL-DIRECTORY.md); historical upgrade rationale: [docs/archive/skills-upgrade-plan-c5.md](docs/archive/skills-upgrade-plan-c5.md).

## Canonical runtime files

- [`flake.nix`](flake.nix): image composition and generated supervisor text
- [`agentbox.toml`](agentbox.toml): feature gates and toolchains
- [`config/entrypoint-unified.sh`](config/entrypoint-unified.sh): runtime bootstrap (boot-time reconciliation of .mcp.json, hooks, model routing)
- [`services/nostr-pod-bridge`](services/nostr-pod-bridge): the sovereign identity + Nostr binary — `bootstrap` (boot phase [2/8]: keypair, pod scaffolding, DID docs, gitmark/blocktrails, `identity.env`), the daemon relay slot, `session-summary` (SessionEnd kind-30840 digest), and the `summarise`/`track` one-shot egress. It replaced `scripts/sovereign-bootstrap.py` and `config/hooks/nostr-session-summary.py`, removing the last `ecdsa` dependency
- [`services/agentbox-manifest`](services/agentbox-manifest): the boot-time TOML/JSON projector — one Rust binary (clap subcommands) that owns every manifest read and config projection at boot: `.mcp.json` upserts, ADR-069 nip98-proxy config, ADR-041 model routing, stack/profile provisioning, and the TUI manifest round-trip. It replaced ~377 lines of inline `python3` in the entrypoint plus four scripts, so **python3 is no longer a boot dependency** (it stays in the image for the supervised Python services: opf-router and code-interpreter)
- [`config/tmux-autostart.sh`](config/tmux-autostart.sh) / [`config/tmux.conf`](config/tmux.conf): tmux session layer
- `[vault]` in [`agentbox.toml`](agentbox.toml): the single path authority for the authored corpus (ADR-2028) — the entrypoint exports `VAULT_ROOT`/`VAULT_PAGES`/`VAULT_FORMAT`/`VAULT_TUI` to every supervised program, tmux window and MCP server, no consumer hard-codes a corpus path, and `tui = "rune"` opens the vault in tmux window 9 **"Notes"** (ADR-2029); corpus writes go through `vault propose` / `vault edit --expect` (ADR-2107), never an in-place helper
- [`config/tab0-bridge/`](config/tab0-bridge/): voice/nostr meta-controller for tmux window 0 — canonical source; deploys to `~/workspace/tab0-bridge` (see its README)
- [`voice/`](voice/): voice + AoE operator console (ADR-044) — Caddy origin (:8444), console site, `unmute-override.yml`; lifecycle `./agentbox.sh voice`, compose `docker-compose.voice.yml` (see [`voice/README.md`](voice/README.md))
- [`config/nip98-proxy/`](config/nip98-proxy/): sole NIP-98-verifying ingress to the AoE serve loopback port, and the multi-upstream sovereign ingress — LAN-published `:9096`, `/mgmt/` → management-api (PRD-021 WS4/ADR-043 D4.6/ADR-045); overlaid to `/opt/agentbox/nip98-proxy`, supervised as `[program:nip98-proxy]`
- [`config/harness-wrappers/`](config/harness-wrappers/): `agent_command_override` wrappers (openrouter/zai) that pin profile isolation + assert the `ANTHROPIC_BASE_URL` redirect and hard-fail loudly on mis-billing (PRD-021 F2-4/N-01)
- [`services/explainer-tools`](services/explainer-tools): the `explainer` skill's Rust tooling — today `explainer-loom-draft` (was `skills/explainer/scripts/loom-draft.mjs`). It does **not** reimplement the façade protocol: that comes from the published [`loom-client`](https://crates.io/crates/loom-client) crate, which `services/dream-engine` and `services/podcast-ingest` also use. One place now knows that a façade can answer HTTP 200 with ontology prose instead of calling the model, that a truncated reasoning model returns *empty* content rather than a short answer, and that grounding applied to a non-ontology subject is a wrong answer rather than a good one — three callers each knew a different subset (ADR-139)
- [`crates/colloquy/`](crates/colloquy/): the cq shared-agent-learning model, clean-room in Rust (ADR-2085/2086). Six crates: [`colloquy-core`](https://crates.io/crates/colloquy-core) (the standard — pure, wasm-capable, Apache-2.0, **published**), [`colloquy-view`](https://crates.io/crates/colloquy-view) (presentation models; depends on core alone, which is why the forum takes both from crates.io and has **no path edge into this repo**), [`colloquy-nostr`](https://crates.io/crates/colloquy-nostr) (kinds 38410–38415, moved from 38100–38105 by ADR-2105; owns the NIP-01 structs, so it is **published** and carries no Nostr-library coupling), [`colloquy-store`](https://crates.io/crates/colloquy-store) (local / shared / relay behind one trait, transports as traits, **published**; **no sixth adapter slot**), `colloquy-backends` (the production transports — the governed `ruvector-mcp.cjs` as a child process and a websocket to the relay; **internal**: it is the only crate still bound to this estate's `nostr-bbs-core` signing and to that specific server, so it is not reusable elsewhere), and `colloquy-mcp` (**internal**, a binary: the six verbs — `query`/`propose`/`confirm`/`flag`/`reflect`/`status` — over stdio, tier chosen by `COLLOQUY_TIER`). Confidence counts **authorising principals**, never accounts: an operator's fifty agents are one voice, and an unregistered pubkey is dropped rather than self-authorising. It **replaced** `precedent-service.js`/`precedent-bridge.js`, now deleted: the `governance-precedents` namespace was empty and nothing called the tools, so there was no migration to keep revertible
- [`crates/sidestr/`](crates/sidestr/): the sidestr sidechain stack in Rust (PRD-024, ADR-2096/2106), four crates **published** at 0.1.0 and **`AGPL-3.0-only`** — attributed ports of Melvin Carvalho's `siding` (plus the schema kernel and blaketestnode), never dual-licensed, never a dependency of a permissive crate: [`sidestr-header`](https://crates.io/crates/sidestr-header) (both header families, no_std, RustCrypto only), [`sidestr-core`](https://crates.io/crates/sidestr-core) (chain document, block build/sign, rules, block file, validating chain; level 1 and the stock family in 0.1, fails closed to taproot key-path), [`sidestr-nostr`](https://crates.io/crates/sidestr-nostr) (own NIP-01 event, a sealed `SignRequest` so only named `sign_*` operations reach a key, kinds 33333/23500/23501/33500-33502/23510-23514 and the estate's 38420-38425), [`sidestr-wallet`](https://crates.io/crates/sidestr-wallet) (coins, selection, key-path spends, burns, peg-in shape behind `SpendSigner`/`SpendPolicy` ports). Every crate is proven against the JS reference as oracle (byte-identical genesis, two-way block interop, spends mined by both engines) and gated by `.github/workflows/sidestr-crates.yml`. The consensus round for level 2 is **not** in core: it is a separate future crate (ADR-2101 consultant review). The sealed root chain and its interim producer: [`config/sidechain/`](config/sidechain/)
- [`config/model-router/`](config/model-router/): the ADR-2080 metaharness router console for the AoE `router` seed — `artefacts.json` is the single pinned source both `flake.nix` (bakes `/opt/agentbox/model-router`) and `scripts/model-router-fetch.sh` (pre-rebuild fallback) read; the console embeds offline and calls ruflo's router directly because the npm tarball omits the artefacts and ruflo's embedder imports a package the closure lacks. `AGENTBOX_MODEL_ROUTER_*` only, never `CLAUDE_FLOW_ROUTER_*` globally; public tier only
- [`scripts/aoe-seed-sessions.mjs`](scripts/aoe-seed-sessions.mjs): reconciler that provisions `[[interaction_plane.session_seeds]]` as AoE sessions and binds each session boundary's identity (PRD-021 WS2/WS3)

## URI/URN scheme

`urn:agentbox:<kind>:[<scope>:]<local>` (scope = 64-char hex pubkey), 20 kinds (`decision` added by ADR-048, `knowledge` by ADR-2085); identity `did:nostr:<hex-pubkey>`; content addressing `sha256-12-<12hex>`. **All durable identifiers are minted through `management-api/lib/uris.js`** — ad-hoc `format!()`/template-literal URNs are prohibited. Resolvability best-effort via `/v1/uri/<urn>` (307/404/410). Ref: [ADR-013](docs/archive/adr/ADR-013-canonical-uri-grammar.md). The host project's parallel `urn:visionclaw:*` grammar and the BC20 anti-corruption bridge: [subsystem-notes §URI](docs/reference/claude-context/subsystem-notes.md).

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

- Deploy with `./agentbox.sh rebuild` (`--no-cleanup` preserves recovery images/caches).
  It loads `docker-compose.override.yml`, which supplies the existing workspace volume,
  external project mounts and `.env`. A base-only `docker compose -f docker-compose.yml`
  recreation omits these and exposes an unrelated workspace bind. Never replace the
  normal launch path with a base-only restart; inspect effective mounts after deployment.
- `HOME=/home/devuser`; workspace at `/home/devuser/workspace` (`$WORKSPACE`). The literal path `/workspace` is retired and will break.
- Supervisord runs as PID 1 root; every long-running program drops to `user=devuser`. No agent-facing process runs as root after bootstrap.
- Older docs describing `gemini-user`/`openai-user`/etc pseudo-users are legacy, not the runtime path.
- Permission mode is **auto** (classifier per action) since 2026-09-03: `dsp` = `claude --permission-mode auto`, `dspb` = the legacy blanket bypass for isolated throwaway containers only (Claude Code 2.1.78+ stopped honouring bypass for `.git/` and `.claude/` writes). The entrypoint seeds `permissions.defaultMode = "auto"` if unset, pre-accepts the auto-mode opt-in dialog, and seeds folder trust for every checkout and worktree (`config/hooks/trust-seed.cjs`), so unattended tmux teammate panes do not block on dialogs.
- **Not every file in `config/hooks/` is a hook.** Two registration sites exist — the entrypoint seeds ROOT-session hooks into `~/.claude/settings.json`, `stacks.rs` projects PER-PROFILE ones into `workspace/profiles/<stack>/.claude/` — and some files are neither: `project-tracking-publish.cjs` is a CLI the management API spawns, `fleet-tab-name.sh` a helper. Inventory + how to add one: [`config/hooks/README.md`](config/hooks/README.md) (ADR-2068).
- AoE session records persist on the `aoe-profiles` volume and the seeder reaps only its own clean, unreferenced orphan worktrees (ADR-2063); `agentbox-mcp hub` waits 120 s for `/run/agentbox/mcp-hub.json`, then exits loudly naming the projection and `[resources.mcp_hub]`; `startsecs=130` parks it FATAL instead of restarting forever (ADR-2104 — the old unbounded wait read RUNNING for three days over a port that was never bound). If the nine hub-routed MCP servers refuse connections, `supervisorctl status agentbox-mcp-hub` first.
- Pods requests are declared unsigned (`sign_requests = false`, ADR-2064) until ADR-2078 wires the sovereign identity key; the fail-closed adapter throws `SigningUnavailable` if the flag is flipped without key material.
- In the Bash sandbox `$HOME` is read-only and `npx` reports a bogus ENOSPC: run tools from `node_modules/.bin` with `HOME` pointed at a scratch dir; jest suites under `tests/contract/` need jest, not `node --test`. CUDA link-time stubs and the real driver both exist — `ldd <binary> | grep libcuda` before calling a host driverless.
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
