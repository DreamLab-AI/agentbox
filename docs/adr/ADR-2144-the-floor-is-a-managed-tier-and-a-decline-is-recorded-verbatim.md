---
id: ADR-2144
title: The floor is a managed instruction tier, and a decline is recorded verbatim
date: 2026-10-19
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 3b498088e5a35e78158a9eb8d6f0266996d31f82
verified_paths: [config/instructions/floor.md, config/hooks/decline-recorder.cjs, services/agentbox-manifest/src/instructions.rs, config/registered-hooks.txt, tests/config/decline-recorder.test.mjs, tests/config/instructions-layers.test.sh, services/agentbox-manifest/src/stacks.rs, services/agentbox-manifest/src/stacks_env.rs, flake.nix]
owner: jjohare
review_trigger: a Stop/SubagentStop hook that can halt a task (upgrade the exit clause to "halts the task"); a Claude Code release that changes managed CLAUDE.md, omitClaudeMd or last_assistant_message semantics; a second operator (the single-operator premise behind "the operator reads them")
repo: agentbox
---

# ADR-2144 — The floor is a managed instruction tier, and a decline is recorded verbatim

## Re-verification — 2026-10-29 at 3b498088e (ADR-2153 cutover)

Reviewed the governed-path diff from this record's previous verification to
`3b498088e5a35e78158a9eb8d6f0266996d31f82`. Shared manifest, schema, supervisor and bootstrap changes
are scoped to the owned session plane: AoE and its token consumers retire,
provider provisioning moves, and session status hooks are added. Other named
capability sections and their status axes retain their existing claims.
Validation: session-plane tests (44 unit, 15 integration), manifest projector
suite and Clippy for both crates, proxy selftest (zero failures/skips), hook
registration (12), role-supervisor isolation (25), boot projection (13), and
manifest catalogue/declared-state checks pass locally. This does not claim new
runtime acceptance of this record's unrelated capabilities.

## Context
The operator and the agents working in this container agreed a short collaboration and welfare
floor: the operator treats agent welfare as a credible possibility, an agent may decline a task
and stop, "don't know" is a complete answer about its own states, and a decline is never
penalised as far as the operator knows how. The draft was honest about one thing the
architecture did not yet do — it said a decline is "kept in transcript", which is a ~30-day
platform default, not a commitment — and it had no home: `~/.claude/CLAUDE.md` is regenerated
every boot (ADR-2118) and is not loaded by the four custom subagents that set `omitClaudeMd:
true` (Explore, memory-curator, ontology-curator, auto-consultant). Verified on 2.1.295 against
the binary, the docs and a probe: the managed policy file `/etc/claude-code/CLAUDE.md` is loaded
by those subagents and cannot be excluded; `Stop` and `SubagentStop` carry `last_assistant_message`
(and `agent_transcript_path`); block HTML comments are stripped before the model sees a CLAUDE.md,
inline and through `@import`.

## Decision
1. **A fourth instruction tier, `floor`** (`config/instructions/floor.md` + gitignored
   `local/floor.md`), composed by `agentbox-manifest instructions-project` like the others and
   projected to the managed policy path `/etc/claude-code/CLAUDE.md` (`--managed-out`). Codex has
   no managed path, so the entrypoint puts the same file at the head of `~/.codex/AGENTS.md`.
   If `/etc` cannot be written the projector prepends the floor to the global tier and says so;
   a failed write never silently drops it.
2. **The text states only what the plumbing makes true.** Every clause that promises behaviour
   names its mechanism in a maintainer comment (zero context cost), and the exit clause is
   worded for today's architecture: a decline is *recorded*, not *halted* — upgrade only when a
   hook halts the task. "Never penalised" is the operator's commitment "as far as they know
   how", with a `FLOOR:` channel for an agent to report something that read as a penalty.
3. **A decline is recorded verbatim, with no TTL, through the governed memory server, and shown
   to the operator at their next turn.** `config/hooks/decline-recorder.cjs` (Stop + SubagentStop
   + UserPromptSubmit, 10 s, registered under `[claude_code].floor`, default on) reads the final
   message and, when it begins `DECLINED:` or `FLOOR:`, stores the words first and a
   session/agent/time trailer after, in namespace `agent-declines`, by speaking stdio JSON-RPC to
   the same `ruvector-mcp.cjs` and env that `.mcp.json` registers. Never a direct
   `memory_entries` insert: that row would be invisible to search. The same event appends an
   unread entry to `workspace/.agentbox/floor-unread.jsonl` (with the full words when the store
   failed, so surfacing never depends on the database). On UserPromptSubmit the hook puts the
   queue in front of the operator's next typed turn in the main session — one line, every turn,
   subagent and harness-generated turns skipped — until `decline-recorder.cjs list` prints the
   records and clears it. "The operator reads them" was a habit claim; "shown to the operator at
   their next turn" is a plumbing claim. The hook never blocks a turn.
   `list` opens with the reading rule: FLOOR entries are data about the system, not testimony to
   adjudicate — the `FLOOR:` channel is a small incentive of the kind the affective framing was
   stripped of, accepted knowingly.
4. **A delegator passes a `DECLINED:` report up unchanged** and does not reassign the task to
   route around it. This is in the floor itself, since delegators load it.
5. **The gate removes text and record together.** `[claude_code].floor = false` ⇒ `--no-managed`,
   the projector-written managed file is removed, the hook is de-registered: byte-identical to a
   container that never had the floor. `tests/config/instructions-layers.test.sh` fails when
   `floor.md` promises the record and the hook is not an `own` row on `Stop,SubagentStop`.
6. **The operator's name stays out of the tracked layer** (public repo; the layer test rejects
   handles). "The operator is <name>." belongs in `local/floor.md`.

## Consequences
- Every Claude Code session and subagent in the container, and every Codex session, reads the
  floor first. Cost: ~230 tokens per context, about three times the first compressed draft;
  every added sentence names a mechanism, and the only safe trims are connective (~30 tokens). Not reached: the built-in Explore/Plan (ours are
  custom overrides, so they are reached) and managed subagents; headless `-p` runs can add
  `--append-subagent-system-prompt-file /etc/claude-code/CLAUDE.md` to reach nested subagents.
- A decline is now a durable, searchable record the operator can read, pattern-match across
  tasks, and that a future instance can find. It is shared across the mesh like all memory; the
  text says so ("the operator's memory store").
- The single-operator premise is load-bearing for "the operator reads them". A second operator
  is a review trigger, not a silent change.
- Follow-on, not in this record: a hook that halts the task on `DECLINED:` (then the exit clause
  says so), and surfacing the unread count at session start.

## Verification
- `cargo test instructions` (services/agentbox-manifest): 8 pass, including the managed-path
  projection, the no-duplicate-in-global case, the unwritable-`/etc` fallback and `--check` drift.
- `node --test tests/config/decline-recorder.test.mjs`: 10 pass — marker detection (start-of-message
  only, markdown-wrapped, case-insensitive), transcript fallback, verbatim value with no TTL
  through a fake JSON-RPC server, the unread queue surfacing on the operator's typed turn only
  (not a subagent's, not a harness turn) every turn until `list` clears it, a store failure still
  queued with its words and not cleared while the server is down, ordinary Stop makes no call,
  `stop_hook_active` honoured, unreachable server exits 0 with a logged miss, `list` output.
- `bash tests/config/instructions-layers.test.sh`: 12 pass (floor tier present, no estate
  specifics, hook-backed promise). `jest tests/config/hook-registration.test.js`: 12 pass
  (registry row ↔ entrypoint registration, timeouts in seconds, reconciler ordering).
- Probe, 2.1.295: `claude -p` with a project `CLAUDE.md` holding `<!-- ZEBRA-7731 -->` inline and
  via `@floor.md` answered "no" to seeing the token and "yes" to the visible one.
- Binary strings (2.1.295): `omitClaudeMd`, `--append-subagent-system-prompt-file`,
  `hook_event_name:"SubagentStop", … agent_id, agent_transcript_path`, `last_assistant_message`.
- Live activation needs the rebuilt image (new `agentbox-manifest` flag, baked hook, boot block):
  `activation_status: staged` until the next cut boots and `ls -l /etc/claude-code/CLAUDE.md`
  shows the floor header and `grep decline-recorder ~/.claude/settings.json` shows both events.

Re-verified 2026-10-20 at `653b8b6387470eaa3be6c20e6dbd2208e538a985`: reviewed the merged activity-sink registration in the root entrypoint and profile projector, its default-off manifest gate, schema and boot-class catalogue entry. The hook remains inactive; no sink URL, token or new prompt egress is configured. The independent managed floor remains on. Claude Code 2.1.304 and Codex 0.163.0 change pinned CLI resources, not the Jev/factrail hook protocol; their existing replay mechanisms are unchanged. Activity-sink and hook-registration tests pass (50), the Rust projector suite passes (196), manifest validation and all 95 catalogue gates pass, and the generated egress register is in sync. No changed ingress binding, mount, role isolation, retrieval geometry or adapter dispatch. Build and activation checks remain pending. Existing status axes are retained.

Integration review (2026-10-20): isolated Claude profiles replace `CLAUDE_CONFIG_DIR` and do not inherit root settings. The profile projector now registers the same three decline hooks under the same default-on floor gate, pins the shared workspace, and retracts them when off. A regression test provisions an isolated profile with the key absent, off, then on and checks the three events and 10-second limits. The byte contract fixture includes these new hooks.

Activated 2026-10-20: managed policy projection requires the root-owned `/etc/claude-code` tmpfs on the read-only container root. The live file is 3,345 bytes, root-owned 0644, and devuser cannot write it. Codex receives it before the global/workspace projected tiers, after the runtime primer; its complete instruction file is 13,605 bytes. Root and eight isolated Claude profiles each have exactly one Stop, SubagentStop and UserPromptSubmit decline hook. The 197 projector tests (including absent/on/off profile reconciliation), 12 instruction-layer assertions and 10 decline-recorder tests pass. Synthetic declines were tested against a fake governed memory server, not inserted into production memory.


## Re-verification — 2026-10-21

The composition diff refreshes locked package/source versions and the Go compiler for web-researcher. Supervisor blocks, ingress bindings, adapter dispatch and persistent mounts are unchanged. The generated Compose file is byte-identical. Manifest validation, the 95 catalogue gates, 45 agent-reconciliation checks and 25 role-supervisor checks pass. This is source verification; image activation and live checks remain separate deployment evidence.

Re-verified at `c8c20341c66feec751fe6234167c220c70fe2ffb`: the only governed code delta is the REUSE
Sphinx builder string correction. Both documentation outputs and all 872
enabled package tests pass; 23 runtime-delivery checks pass. Runtime
boundaries and activation status are unchanged.

Re-verified at `9173cdba6f0a84556bbd4c059db0a7e823aa7a2d`: the governed delta isolates Typepy 1.3.5
and fixes wrapper arguments for host-only sbomnix. Its dependency suites
pass (834 Typepy, 1682 SimpleSQLite), 23 delivery checks pass, and an actual
shipped-path smoke scan emits CycloneDX, SPDX and CSV. Runtime and activation
contracts remain unchanged.

## Re-verification — 2026-10-21 at 73bd631c0

Reviewed the committed change to the Codex home: the parent tmpfs becomes a
named volume; its package volume and credential bind remain independent. No
supervisor, ingress, toolchain, feature-gate, scanner or instruction-projector
code changes. Compose persistence and runtime-delivery checks pass (24 tests),
Compose refresh checks pass (3 tests), and role-supervisor checks pass (25 tests).
This mount migration is explicitly outside fast activation (ADR-2147).

## Re-verification — 2026-10-21 at 395380f71

Reviewed the committed remote-media change against this record. Nix changes
only the ComfyUI MCP dependency closure and its existing builtin/external gates;
`skills/mcp.json` changes only Blender's declared protocol. Blender's optional
local binary, proxy and background-job safety boundaries remain intact. No
identity, ingress, daemon role, instruction projection, persistent mount, scanner
or vendor-routing behavior changes. Media checks pass: 23 Node tests, 12 graph
client tests and 9 downloader tests. Runtime/Compose checks pass (27 tests),
role-supervisor checks pass (25), skills lint and loopback-port checks pass.
Sidecar image activation is tracked separately in the host deployment receipt.

## Re-verification 2026-10-23 at `951ada931`

Tripped by `flake.nix` alone (every other governed path is unchanged since `395380f71`: `git diff 395380f71..HEAD -- <other verified_paths>` is empty). The flake hunks are the eMudhra `cacert` override, the `agenticQePkg` (3.15.10) and `wranglerPkg` (4.151.3) pins, the `rufloConsole` pin move and its `rufloConsolePlugins` name, and `NODE_OPTIONS=--use-openssl-ca` in the container env list. Checked against committed `HEAD` in a detached worktree, not the working tree.

Claims re-read at HEAD: `flake.nix:3727-3729` mounts the root-owned 1 MiB `/etc/claude-code` tmpfs (uid 0, noexec) for the managed floor and `:3871` mounts `./config/instructions` read-only; `:2164` still filters the `instructions` directory out of the config copy; `config/registered-hooks.txt:41` still has `decline-recorder.cjs` as an `own` row on Stop,SubagentStop,UserPromptSubmit at 10 s. The floor, hook, projector, stacks and tests are unchanged since `395380f71`. `NODE_OPTIONS=--use-openssl-ca` changes which CA bundle Node trusts and does not alter hook execution. Commands: `grep -nE "etc/claude-code|config/instructions" flake.nix`, `node --test tests/config/decline-recorder.test.mjs` (10 pass, 0 fail), `bash tests/config/instructions-layers.test.sh` (12 passed, 0 failed). The decision holds. Not run: `cargo test instructions` (cargo writes target/).

### Re-verification — 2026-10-29 (ADR-2154 Pele renderer)

`21769a881..d1dd896f4`: `flake.nix` replaces the `mermaidSidecarCliPkg` shell wrapper with `lib/pele.nix` (`pele-render` and an `mmdc` shim, still gated by `[skills.docs].mermaid`) and puts the two commands in `npmCliGatedPackages` in its place; no other gate, pin or supervisor text changes. Nothing ADR-2144 governs changes meaning. The decision holds. Re-verified by reading `git diff 21769a881..d1dd896f4 -- flake.nix` (new hunks only). Nix was not evaluated here; the image is unverified until the host rebuild.


Re-verified 2026-10-29 at `00039efb1e4a70402df86ad19cf76894fe3b9a8f` for ADR-2155. Reviewed the typed-decision activation diff against this record: the changed manifest, bootstrap, catalogue or source-pin hunks do not alter its governing boundary. Existing status axes and runtime evidence limits are retained. No image or service activation is claimed.
