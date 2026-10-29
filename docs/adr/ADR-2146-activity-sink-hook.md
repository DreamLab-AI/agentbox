---
id: ADR-2146
title: Agent activity leaves through one generic, manifest-gated, fail-open sink hook
date: 2026-10-17
decision_status: proposed
implementation_status: complete
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit: 3b498088e5a35e78158a9eb8d6f0266996d31f82
verified_paths: [config/hooks/activity-sink.cjs, config/entrypoint-unified.sh, services/agentbox-manifest/src/stacks.rs, services/agentbox-manifest/src/stacks_env.rs, tests/config/activity-sink.test.js, config/egress-policy.json]
owner: jjohare
review_trigger: a second consumer of the sink, a change to the wire body, a new event or tool class, moving the token under role isolation (ADR-2122), or any change to the ADR-2026 redactor
repo: agentbox
domain: GOVERNANCE-capabilities
---

# ADR-2146 — Agent activity leaves through one generic, manifest-gated, fail-open sink hook

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
External consumers want live agent activity: which files an agent is touching, what it was asked, and what it answered. The first consumer is a host-side code-visualisation service (Codescape), which draws agents as presences on the code graph and listens on a compose-network-only ingest port (for example `http://codescape:4101/ingest/v1/activity`). Two existing seams were considered and rejected (see Alternatives). Hooks have two registration sites, the root session (`config/entrypoint-unified.sh`) and per-profile settings (`services/agentbox-manifest/src/stacks.rs`), and a new hook has to be wired in both (ADR-2068). Prompt and answer text leaving the container is egress under ADR-2026.

## Decision
1. **One generic hook:** `config/hooks/activity-sink.cjs`. It names no consumer. For each event it POSTs one record `{actor, kind:"agent", event, tool, paths, text, ts_ms, session_id}` with `Authorization: Bearer <token>`:
   - `PostToolUse`: Read, Edit, Write, MultiEdit and NotebookEdit post their file path; Grep and Glob post `path`, or the cwd if there is none. Paths are absolute. Every other tool, Bash included, posts nothing.
   - `UserPromptSubmit`: the prompt.
   - `Stop`: the last assistant text read from the transcript tail.
   - `actor` is `<ACTIVITY_SINK_ACTOR | AGENTBOX_PROFILE | AGENT_STACK | claude>:<first 8 characters of the session id>`.
2. **Gated by `[integrations.activity_sink]`** (`enabled`, `url`, `token_file`, `token_env`, `events`). The gate is boot-class:
   - The entrypoint registers the hook in `~/.claude/settings.json`, and `provision-stacks` registers it in every Claude profile.
   - Only the selected events are registered. `post_tool_use` carries a file-tool matcher, so node never starts for a Bash call.
   - Root registration filters out any prior entry and then pushes the canonical one, so a changed url or token path corrects itself. Profile settings are rewritten whole every boot.
   - When the gate is off, or the url is empty or not http(s), every registration is retracted. A settings file with no entry is left byte-identical.
3. **The token value is never inlined.** The command carries only the url, the token file *path* or env-var *name*, and the event list. `settings.json` is a host mount.
4. **Fail-open, with the egress side fail-closed:**
   - The request budget is 1 s, with a hard exit shortly after it. The hook writes nothing to stdout and always exits 0.
   - It never sends without a token.
   - It never sends the token over plaintext to a public host. `https:` is always allowed. `http:` is allowed only to localhost, 127.0.0.0/8, `::1`, RFC 1918 addresses or a single-label compose service name. Anything else is refused before the token is read, with one stderr line naming only the host.
   - `AGENTBOX_EGRESS=0` stops the route, and `AGENTBOX_EGRESS_REDACTION=0` refuses it.
   - Text is redacted with the ADR-2026 prose redactor (`lib/egress-policy.cjs`) **before** it is truncated to 2 KiB on a UTF-8 boundary. If redaction fails, `text` is `null`, never the raw string.
   - The route is listed in the egress register (`config/egress-policy.json`, row `activity-sink`).
5. **Redactor choice.** The consumer's decision record asked for the trajectory recorder's redactor. That one is shell-shaped. The ADR-2026 prose redactor is the contract for session text leaving the container, and on prose the two agreed in every case probed.

## Invariants
| Invariant | Enforced by |
|---|---|
| Wire body shape and bearer header; Bash posts nothing | `tests/config/activity-sink.test.js` (wire contract) |
| Redact before truncate; ≤ 2048 bytes; no split character | same, `UserPromptSubmit` and boundary cases |
| A silent sink cannot hold a turn: exit 0 in < 1.5 s; stdout always empty | same, "never holds the turn" |
| Empty url → no request; no token → no request; `AGENTBOX_EGRESS=0` → no request | same |
| No bearer token over `http:` to a public host; the token never appears in any log line | same, "transport guard" and "the token is never logged" |
| Root registration self-heals, never inlines the token, retracts when off | same, `<<'ASJS'` block cases; `tests/config/hook-registration.test.js` (registry row, order before reconcile) |
| Profile registration only when the gate is usable; token path only | `cargo test` in `services/agentbox-manifest` (`stacks::tests::activity_sink_*`) |
| The route is registered as egress | `node scripts/ci/render-egress-register.js --check` |

## Consequences
- An external consumer gets file-level presence without agentbox knowing it exists. A second consumer is a second sink URL behind another hook instance, not a change here.
- **The token is devuser-class (Q8).** The hook runs in the agent's own process, so ADR-2122's root-owned `/run/secrets/<role>/` cannot hold it. Moving the token under role isolation needs a devuser-readable delivery path or a relay through the identity port. This ADR does not claim either.
- Each selected event costs one `node` process: 50–65 ms wall-clock in this container for both the disabled no-op and a post to a refused port (5 runs, 2026-10-17). Only hook-tracked tools, prompts and turn ends pay it.
- Paths are not redacted. Prompt text and answer text leave, redacted. A sink URL off the LAN is possible: the url is the operator's declaration and is not checked.

## Alternatives
- **tab0-bridge `/feed`:** covers the tab-0 session only and carries text without file paths.
- **The trajectory recorder's `/v1/agent-events/emit` publisher:** gated behind the learning flags, Stop-time and Bash-centric (it grades commands, not file touches). PostToolUse does not fire for failing Bash.
- **`claude-flow-hook-adapter.cjs`:** spawns the claude-flow CLI per event and has no sink abstraction.
- **Reading the manifest in the hook (live-class):** a TOML parse on every tool call, plus a second copy of the gate logic outside the projector.

## Verification
At the worktree on 2026-10-17 (uncommitted on `feat/codescape-activity-sink`):
- `jest tests/config/activity-sink.test.js`: 38/38 pass. Mutation check: swapping redact and truncate in `safeText` turns the boundary case red (18/19).
- `jest tests/config/hook-registration.test.js`: 12/12 pass. `tests/sovereign/egress-boundary.test.js` passes with the management-api dependencies present.
- `cargo test` in `services/agentbox-manifest`: 146 unit tests plus 47 integration tests pass, including `stacks::tests::activity_sink_*` (2).
- `node scripts/agentbox-config-validate.js agentbox.toml`: valid. An unknown event is rejected (E016).
- `render-egress-register.js --check`: in sync.

Merged and re-verified at `653b8b6387470eaa3be6c20e6dbd2208e538a985` on 2026-10-20: 50 activity-sink/registration tests and 196 Rust projector tests pass; the manifest and all 95 catalogue gates validate; the egress register is in sync. The colliding branch ADR number was changed to ADR-2146. The gate remains off and acceptance remains proposed. The image itself is unverified until the host rebuild runs, so activation stays `inactive` (the gate defaults off).

Re-verified 2026-10-20 at `ca056f04622659d54d4d4546d033d80d7203aa9d`: isolated-profile provisioning now includes the default-on managed floor decline hooks on Stop, SubagentStop and UserPromptSubmit, using the shared workspace and 10-second fail-open commands. The new test checks default/on/off reconciliation; the byte-contract fixture is updated. All 197 projector tests pass. Activity-sink policy remains independently default-off. Activation evidence remains pending.


Re-verified 2026-10-29 at `00039efb1e4a70402df86ad19cf76894fe3b9a8f` for ADR-2155. Reviewed the typed-decision activation diff against this record: the changed manifest, bootstrap, catalogue or source-pin hunks do not alter its governing boundary. Existing status axes and runtime evidence limits are retained. No image or service activation is claimed.


Security follow-up re-verified 2026-10-29 at `7d8c3b2dfe165f4ab3f8a5e4f62b8294ea7b155d`: the changed hunks drop privilege before workspace credential writes, replace credentials atomically, reject typed-decision redirects and retain the timeout through response parsing. The stalled-body, planted-symlink and HTTP307 regressions pass. These strengthen the existing boundaries; status axes and activation limits are unchanged. The original Deepsec report remains BLOCK with a separate remediation receipt, not a claimed clean rescan.
