# CodeAct — Operations, Degradation, Session Semantics, Composition

Operational detail for the `codeact` skill. The lean protocol lives in
`../SKILL.md`; this file carries the failure contract, manifest gate, kernel
session lifecycle, identity/ecosystem tagging, and how CodeAct composes with
neighbouring skills.

---

## Degradation

If the `code-interpreter` MCP is unreachable when a CodeAct call is
attempted, this skill **must not** silently fall back to `python -c` Bash
spawns. A silent Bash fallback would lose kernel state without warning, break
the CodeAct Loop contract, and produce incorrect multi-turn behaviour with no
observable error signal.

The required behaviour is:

1. Detect that the `code-interpreter` MCP tool surface is unavailable (the
   MCP server returns a connection error or the `kernel.exec` call times out
   before the kernel process exists).
2. Emit a `DegradedExecution` event (per DDD-005 §Events) with
   `fallback_path: "pytorch-ml-script-mode"` and `reason: "kernel-mcp-unavailable"`.
3. Route the agent to `pytorch-ml` in script mode for stateless execution, or
   halt with an explicit error if even that fallback is inappropriate (e.g. the
   task requires cross-call state that script mode cannot provide).
4. Never present a clean `kernel.exec` tool surface that is silently backed by
   a dead kernel or a shell subprocess.

This fail-closed behaviour is mandated by ADR-018 §Decision D6 and mirrors the
ADR-015 principle that the RuVector MCP fails closed if PostgreSQL is
unreachable.

The `DegradedExecution` event is observable by the operator via the
`agentbox.mcp.code_interpreter.exec` OTLP span and the
`code_harness_kernel_exec_total{outcome="kernel_restarted"}` Prometheus counter.

---

## Manifest Gate

This skill is inactive unless `[skills.code_interpreter] enabled = true` in
`agentbox.toml`. When the gate is off, the skill appears in the
SKILL-DIRECTORY but emits a `DegradedExecution` event on any invocation and
routes to `pytorch-ml` script mode.

```toml
[skills.code_interpreter]
enabled           = true   # required for codeact to function
max_memory_mb     = 512    # kernel process ceiling (advisory)
allow_pip_install = false  # keep false unless a specific allowlist is configured
idle_timeout_s    = 1800   # kernel pauses after 30 min idle; resumes on next call
```

Validator errors that block boot when the gate is misconfigured:

- `E042`: `allow_pip_install = true` requires `pip_allowlist` to be non-empty.
- `E043`: `enabled = true` requires `jupyter_client` in the Nix environment.

---

## Session Semantics

The `KernelSession` is one IPython kernel process per Claude session, spawned
lazily on the first `kernel.exec` call. Cold-start target is < 500 ms.

Variables, imports, and in-memory objects persist for the session lifetime.
They do not survive session end -- the session-end hook calls
`kernel_manager.shutdown_kernel(now=True)`. If results must survive across
sessions, serialise them explicitly:

```python
# Within a kernel.exec call:
df.to_parquet('/home/devuser/workspace/tmp/intermediate.parquet')
```

`kernel.reset` clears the namespace mid-session without restarting the MCP
server process. Use it when namespace pollution from a failed branch would
interfere with the next attempt.

`kernel.list_vars` and `kernel.inspect` are introspection tools. Use them
when the CodeAct Loop loses track of what is in the namespace after many
revision cycles.

`kernel.interrupt` sends SIGINT to a running cell. Call it when a
`kernel.exec` is hung (e.g. an infinite loop). The kernel returns to `Live`
state with an interrupted `ExecutionTrace`.

---

## Identity and Ecosystem Alignment

The `KernelSession` and every `ExecutionTrace` it emits are tagged with the
agentbox-wide identity stack (per ADR-013 and `agentbox/CLAUDE.md`):

| Field | Form | Source |
|---|---|---|
| `owner_did` | `did:nostr:<hex>` | env `AGENTBOX_AGENT_DID`; falls back to `did:nostr:local` in dev mode |
| `KernelSession` URN | `urn:agentbox:thing:<scope>:kernel-<short-id>` | minted at kernel spawn |
| `ExecutionTrace` URN | `urn:agentbox:activity:<scope>:trace-<short-id>-<seq>` | minted per `kernel.exec`; the trace IS its own action receipt |
| `action_verb` | `exec` | always `exec` for the kernel surface |

These are the same URN kinds the rest of the agentbox ecosystem uses
(`solid-pod-rs`, `nostr-rust-forum`, `VisionClaw`, `dreamlab-ai-website`).
The `codeact` skill consumes traces by URN — never invent your own
identifiers; always read `trace_urn` from the response and pass it
forward to ExpeL / Voyager / Activity records.

---

## Composes With

**`expel-lesson-extractor`**: At task end, the ExpeL distillation step
(triggered by the `post-task` hook when
`[features.expel_lesson_extraction] enabled = true`) consumes the full task
Trajectory -- the ordered sequence of `ExecutionTrace` records and agent turns
-- and extracts `DistilledLesson` records stored in the
`code-harness-lessons` RuVector namespace. These lessons are retrieved
semantically at the start of future tasks of similar character. The CodeAct
Loop produces richer trajectories than stateless skills, which in turn
produces richer lessons.

**`voyager-skill-library`**: Any Python function that the CodeAct Loop
produces and validates via inline assertions can be nominated to the
`VerifiedSkill` library. The nomination path requires:
(a) the function executes without exception in a `KernelSession`,
(b) all inline assertions pass, and
(c) the `verification-quality` truth-score reaches >= 0.95 (ADR-019).
Functions meeting all three gates are stored in the `code-harness-skills`
RuVector namespace with a semantic embedding and retrieved for injection into
future tasks. This is the Voyager pattern applied to software engineering
trajectories. Functions that pass (a) and (b) but not (c) are quarantined in
`skill-candidates` and not injected.

**`tree-search-coder`**: When Phase 2c of PRD-008 is enabled, the
execution-gated tree-search skill generates N candidate programs and calls
`kernel.exec` on each, scoring by the resulting `ExecutionTrace` metrics (pass
rate, wall time, assertion coverage). The best branch is selected by
Trace-as-Reward, not by LLM preference. The CodeAct skill and the tree-search
skill share the same `KernelSession` interface; no additional MCP is needed.
