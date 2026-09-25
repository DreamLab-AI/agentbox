# Runtime Files, Agents and Skills — Relocated CLAUDE.md Detail

> Relocated verbatim from `CLAUDE.md` (2026-09-25 always-loaded context cut). The
> top-level `CLAUDE.md` keeps a one-line purpose per file plus the constraints an
> agent cannot discover from the tree; the descriptive depth lives here. Load on
> demand when working on the subsystem named. Crate detail (colloquy, sidestr) is in
> [crates.md](crates.md).

## Agents & commands — manifest-governed (ADR-2092)

The image bakes `/opt/agentbox/agents` (12 subagents) and registers them from
`agents/registered-agents.txt`; `scripts/reconcile-agents.sh` projects that set into
`~/.claude/agents` at boot, retires vendor dumps to a recoverable sidecar outside every
scanned root (`~/.claude/agentbox-superseded/{agents,commands}/<root-key>/` — an in-root
`.superseded/` still loads, since Claude Code scans agent and command roots recursively,
dot-dirs included; legacy in-root sidecars are migrated out on every run), and collapses `$WORKSPACE/.claude/agents` + `$WORKSPACE/project/.claude/agents` so the
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
still work. Gate: `bash tests/config/agent-reconcile.test.sh` (45 assertions) before a
rebuild.

**Never write a `/nix/store/...` path into persistent config.** Store paths are
content-addressed and change every rebuild; `.mcp.json` and `~/.claude` are host mounts that
outlive them. Pin `/opt/agentbox/bin/<tool>` (baked in `flake.nix` as a symlink) and make the
registration self-healing — compare the recorded value against the canonical one rather than
guarding with `grep -q '"name"'`, which registers once and can never correct a stale entry.
Both mistakes together are what left the colloquy MCP server failing `ENOENT` against a
garbage-collected store path while the container looked healthy.

## Skills — progressive discovery

Skills are the JIT context layer: trigger-led descriptions route, `references/` subdirs
hold depth loaded on demand — keep it that way when adding or editing skills (no monolith
SKILL.md; relocate depth to `references/` rather than deleting it; skill docs use
skill-relative paths, never `~/.claude/skills/<name>/`). A whole skill may be **removed**
when measurement plus an operator decision support it (ADR-2089; first applied 2026-09-16
to four tooling-free thinking lenses) — that is a deliberate, git-recoverable act, not a
licence to trim depth out of a skill that stays.

One authoring contract (ADR-2083, taught by `skills/skill-builder`): `name` equals the
directory, `description` ≤ 1024 chars with what/when/when-not (the linter warns above 600
chars — every registered description is always in context), Claude-only affordances stated
in one line with the Codex fallback.

Discovery is generated: `skills/gen-routing-table.mjs` +
`skill-router/references/section-map.json` produce the router table; a new skill needs a
section-map entry and a `SKILL-DIRECTORY.md` row. Registration is by manifest —
`skills/registered-skills.txt` (Claude Code, always-loaded) and
`skills/codex-registered-skills.txt` (Codex / GPT-6 Astra) — reconciled into
`~/.claude/skills` and `~/.codex/skills` at boot.

Compaction is Jev-judged by default (ADR-2093): `[features.jev_compaction]` installs the
function-hook plugin `config/claude-plugins/jev-compaction` (Claude Code ≥ 2.1.274), which
drops or truncates only the tool calls Jev says are stale and never rewrites text;
**email-tainted sessions always get the built-in summary**, `/jev-compact on|off|status`
is the switch, and any failure falls open to the built-in compaction.

Routing is live by default (ADR-2091): `[skills.routing].router = "jev"` registers
`config/hooks/skill-route.cjs` on `UserPromptSubmit`, one System One Choice over every
routable description per turn injected as advisory context, and `/route` shares its
library; it fails open to `"table"` (the always-loaded descriptions + `routing-table.md`,
the pre-2091 path) on any failure — never treat the pick's probability as a gate
(ADR-2090).

Gate: `skills/lint-skills.sh` must pass before a rebuild. Directory + routing:
[skills/SKILL-DIRECTORY.md](../../../skills/SKILL-DIRECTORY.md); historical upgrade
rationale: [docs/archive/skills-upgrade-plan-c5.md](../../archive/skills-upgrade-plan-c5.md).

## Canonical runtime files — full entries

- [`flake.nix`](../../../flake.nix): image composition and generated supervisor text
- [`agentbox.toml`](../../../agentbox.toml): feature gates and toolchains
- [`config/entrypoint-unified.sh`](../../../config/entrypoint-unified.sh): runtime bootstrap (boot-time reconciliation of .mcp.json, hooks, model routing)
- [`services/nostr-pod-bridge`](../../../services/nostr-pod-bridge): the sovereign identity + Nostr binary — `bootstrap` (boot phase [2/8]: keypair, pod scaffolding, DID docs, gitmark/blocktrails, `identity.env`), the daemon relay slot, `session-summary` (SessionEnd kind-30840 digest), and the `summarise`/`track` one-shot egress. It replaced `scripts/sovereign-bootstrap.py` and `config/hooks/nostr-session-summary.py`, removing the last `ecdsa` dependency
- [`services/agentbox-manifest`](../../../services/agentbox-manifest): the boot-time TOML/JSON projector — one Rust binary (clap subcommands) that owns every manifest read and config projection at boot: `.mcp.json` upserts, ADR-069 nip98-proxy config, ADR-041 model routing, stack/profile provisioning, and the TUI manifest round-trip. It replaced ~377 lines of inline `python3` in the entrypoint plus four scripts, so **python3 is no longer a boot dependency** (it stays in the image for the supervised Python services: opf-router and code-interpreter)
- [`config/tmux-autostart.sh`](../../../config/tmux-autostart.sh) / [`config/tmux.conf`](../../../config/tmux.conf): tmux session layer
- `[vault]` in [`agentbox.toml`](../../../agentbox.toml): the single path authority for the authored corpus (ADR-2028) — the entrypoint exports `VAULT_ROOT`/`VAULT_PAGES`/`VAULT_FORMAT`/`VAULT_TUI` to every supervised program, tmux window and MCP server, no consumer hard-codes a corpus path, and `tui = "rune"` opens the vault in tmux window 9 **"Notes"** (ADR-2029); corpus writes go through `vault propose` / `vault edit --expect` (ADR-2107), never an in-place helper
- [`config/tab0-bridge/`](../../../config/tab0-bridge/): voice/nostr meta-controller for tmux window 0 — canonical source; deploys to `~/workspace/tab0-bridge` (see its README)
- [`voice/`](../../../voice/): voice + AoE operator console (ADR-044) — Caddy origin (:8444), console site, `unmute-override.yml`; lifecycle `./agentbox.sh voice`, compose `docker-compose.voice.yml` (see [`voice/README.md`](../../../voice/README.md))
- [`config/nip98-proxy/`](../../../config/nip98-proxy/): sole NIP-98-verifying ingress to the AoE serve loopback port, and the multi-upstream sovereign ingress — LAN-published `:9096`, `/mgmt/` → management-api (PRD-021 WS4/ADR-043 D4.6/ADR-045); overlaid to `/opt/agentbox/nip98-proxy`, supervised as `[program:nip98-proxy]`
- [`config/harness-wrappers/`](../../../config/harness-wrappers/): `agent_command_override` wrappers (openrouter/zai) that pin profile isolation + assert the `ANTHROPIC_BASE_URL` redirect and hard-fail loudly on mis-billing (PRD-021 F2-4/N-01)
- [`services/explainer-tools`](../../../services/explainer-tools): the `explainer` skill's Rust tooling — today `explainer-loom-draft` (was `skills/explainer/scripts/loom-draft.mjs`). It does **not** reimplement the façade protocol: that comes from the published [`loom-client`](https://crates.io/crates/loom-client) crate, which `services/dream-engine` and `services/podcast-ingest` also use. One place now knows that a façade can answer HTTP 200 with ontology prose instead of calling the model, that a truncated reasoning model returns *empty* content rather than a short answer, and that grounding applied to a non-ontology subject is a wrong answer rather than a good one — three callers each knew a different subset (ADR-139)
- [`crates/colloquy/`](../../../crates/colloquy/) and [`crates/sidestr/`](../../../crates/sidestr/): see [crates.md](crates.md)
- [`config/model-router/`](../../../config/model-router/): the ADR-2080 metaharness router console for the AoE `router` seed — `artefacts.json` is the single pinned source both `flake.nix` (bakes `/opt/agentbox/model-router`) and `scripts/model-router-fetch.sh` (pre-rebuild fallback) read; the console embeds offline and calls ruflo's router directly because the npm tarball omits the artefacts and ruflo's embedder imports a package the closure lacks. `AGENTBOX_MODEL_ROUTER_*` only, never `CLAUDE_FLOW_ROUTER_*` globally; public tier only
- [`scripts/aoe-seed-sessions.mjs`](../../../scripts/aoe-seed-sessions.mjs): reconciler that provisions `[[interaction_plane.session_seeds]]` as AoE sessions and binds each session boundary's identity (PRD-021 WS2/WS3)

## RuVector — generic environment rules

The environment-wide RuVector rules (connection, MCP-only access, embedding model,
HNSW index law, the `CREATE INDEX CONCURRENTLY` prohibition, embed cap) have a single
always-loaded home in the workspace-tier `CLAUDE.md`. The repo-specific rules
(orchestration proxy, recall-gate floor, sona/attention_rerank off, protected
`ruvnet-kb`) stay in this repo's `CLAUDE.md`. Full audited state:
[ruvector-memory-state.md](ruvector-memory-state.md).

## Other detail trimmed from `CLAUDE.md` (2026-09-25)

- **Architecture:** the AoE interaction plane superseded the MAD-style per-provider harness tabs in place. Full adapter spec: [PRD-001](../../archive/prd/PRD-001-capabilities-and-adapters.md); adapter architecture: [ADR-005](../../archive/adr/ADR-005-pluggable-adapter-architecture.md).
- **URN scheme:** the 20 kinds include `decision` (ADR-048) and `knowledge` (ADR-2085). Resolvability is best-effort via `/v1/uri/<urn>` (307/404/410). Grammar: [ADR-013](../../archive/adr/ADR-013-canonical-uri-grammar.md).
- **AoE hub history:** the old unbounded `agentbox-mcp hub` wait read RUNNING for three days over a port that was never bound (ADR-2104); nine MCP servers are hub-routed (`[resources.mcp_hub].servers`).
- **Agent prompts for Claude Fable 5.1:** request concise progress updates during long tool loops, permit batching independent tool calls, require completion without re-asking for already-authorised steps, and prefer targeted edits over whole-file rewrites.
- **Subsystem pointers:** browser container — [browsercontainer/README.md](../../../browsercontainer/README.md); voice plane — [voice/README.md](../../../voice/README.md) and [config/tab0-bridge/README.md](../../../config/tab0-bridge/README.md) (Caddy :8444, tab0-bridge :8971, Unmute loop); security audit sprint — CHANGELOG.md `[Security Audit Sprint] - 2026-05-11` (7 fixes).
