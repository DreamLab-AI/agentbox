# DDD-005: Code Execution and Experiential Learning Domain

**Date**: 2026-05-20
**Status**: Draft
**Bounded Context**: Code Execution and Experiential Learning
**Cross-references**: PRD-008, ADR-018, ADR-019, DDD-001, DDD-002, DDD-004

---

## TL;DR for newcomers

*Skip if you already know the code-execution bounded context.*

This DDD captures the Code Execution and Experiential Learning bounded context: the part of the system that owns what happens when an agent writes code, runs it, observes the result, and — crucially — learns from that result across runs and sessions. The pain point is threefold: agentbox currently has no persistent kernel runtime (each tool call starts fresh, discarding interpreter state), no cross-run lesson distillation (each task starts with no memory of what worked last time), and no verified skill primitives (executable functions are written, used once, and discarded). The shape of the answer combines a persistent `KernelSession` runtime (ADR-018) accessed via a code-interpreter MCP, the CodeAct loop (write → exec → observe `ExecutionTrace` → revise), an ExpeL-style lesson distillation pipeline (ADR-019) that extracts durable `DistilledLesson` records from completed trajectories, and a Voyager-style `VerifiedSkill` library that accumulates executable code functions which have passed a strict `VerificationGate`. The domain consumes the RuVector context for vector storage, is gated by the DDD-001 Immutable Bootstrap context, and its kernel service liveness/readiness is governed by the DDD-002 Runtime Contract. Lessons and skills may optionally be exposed via the DDD-004 JSON-LD federation surfaces when the `[linked_data]` toggle is enabled.

**If you remember only one thing:** this domain owns the full lifecycle from code execution through trace verification to durable, reusable, verified skill accumulation — the substrate that makes agentbox agents improve across sessions without fine-tuning.

---

## Domain Purpose

The truth this domain owns is simple: when an agent says "run this code", something must survive that call. Variables persist across turns. The `ExecutionTrace` is the canonical evidence record, not an LLM's claim about what happened. When a task completes, the pattern of what worked is distilled into a short, scoped `DistilledLesson` stored durably against the agent's identity. When a function proves itself across assertions and examples, it graduates into the `VerifiedSkill` library and becomes available to future agents. Nothing in this lifecycle requires model retraining — it is entirely an inference-time pattern composed over the existing adapter and MCP infrastructure.

---

## Bounded Context Definition

**Boundary**: This domain owns code-execution lifetime, trace verification, lesson distillation, and verified-skill storage.

**Owns**:
- `KernelSession` lifecycle (spawn, exec, interrupt, reset, terminate).
- `ExecutionTrace` as the canonical evidence record.
- `DistilledLesson` aggregate (post-task experiential learning via the ExpeL pipeline).
- `VerifiedSkill` aggregate (Voyager-style executable skill library with verification gate).
- `VerificationGate` policy (assertion-pass + example-pass + security-pass).

**Does not own**:
- Skill dispatch routing (skill-router context — it consumes `VerifiedSkill` as a read model via the `SkillDispatchPort`).
- Vector storage primitives (RuVector context — consumed here as a port via two namespaces only: `code-harness-lessons` and `code-harness-skills`).
- Build composition and Nix packaging (Immutable Bootstrap context, DDD-001).
- Kernel liveness and readiness probe semantics (DDD-002 owns these; the kernel is a supervised service and its probe contract is declared there).
- JSON-LD encoding of emitted events (DDD-004 owns the encoding surface; this domain emits plain domain events and exposes an opt-in JSON-LD port).

---

## Ubiquitous Language

| Term | Definition |
|---|---|
| **KernelSession** | A live, addressable, stateful execution context bound to one Claude session or one worktree. Variables, imports, and computed values persist across `exec` calls until the session is terminated or reset. Each session has a stable URN identity. |
| **ExecutionTrace** | The immutable record of one `exec` call: code hash, stdout, stderr, exception (if any), last-expression value representation, duration in milliseconds, and timestamp. The canonical evidence for any verification claim — traces are facts, not opinions. |
| **CodeAct Loop** | Write → exec → observe trace → revise. The agent's action protocol when this domain is engaged. Unifies tool invocation and reasoning into a single executable artefact rather than separate JSON messages (arxiv:2402.01030). |
| **Trace-as-Reward** | The principle that an execution trace is the verification signal, not an LLM-judge's opinion. If the trace shows an exception, the candidate failed. If assertions execute clean, the candidate passed. No separate reward model is required. |
| **CodeInterpreterDispatch** | A single MCP `tools/call` into the kernel, wrapped by the ADR-005 observability middleware. The lowest-level observable unit in this domain. |
| **DistilledLesson** | A short, scoped, natural-language rule extracted from a completed trajectory by the ExpeL distillation step. Persisted in RuVector namespace `code-harness-lessons`. Carries a `LessonConfidence` scalar that degrades on contradiction. |
| **VerifiedSkill** | An executable code primitive (Python function body + assertions + ≥1 example invocation) that has passed the `VerificationGate`. Persisted in RuVector namespace `code-harness-skills`. Referenced by its URN at retrieval time. |
| **VerificationGate** | The set of policies a candidate skill must satisfy before being written into the skill library: all assertions execute clean in a `KernelSession`, at least one example runs without exception, and no banned APIs are present in the function body. |
| **LessonConfidence** | A scalar in [0, 1] attached to each `DistilledLesson`. Initialised at write time based on the distillation evidence quality. Decremented by at least 0.1 each time a subsequent execution trace contradicts the lesson's stated rule. |
| **SkillProvenance** | The agent identity (did:nostr pubkey) and trajectory ID that produced a `VerifiedSkill`. Stored on the skill record and included in the `SkillVerified` event. Enables audit of which agent authored which skill. |
| **DegradationFallback** | When the kernel MCP is unreachable but a CodeAct call is attempted, this domain must not silently no-op. It invokes `pytorch-ml` script-mode as a fallback execution path and emits a `DegradedExecution` event with the fallback path recorded. |
| **Trajectory** | The ordered sequence of `ExecutionTrace` records and agent turns for a single task, from first `exec` to task completion or explicit failure. The unit of evidence consumed by the ExpeL distillation step. |
| **ExpeL Distillation** | The post-task step (triggered by the `post-task` hook) that extracts `DistilledLesson` records from a completed trajectory. Runs one structured LLM call (~500 tokens) against the trajectory to produce cross-run generalisable rules. Does not run on interrupted trajectories. |
| **Idle Timeout** | A manifest-gated duration (`[skills.code_interpreter].idle_timeout_s`) after which an idle `KernelSession` is automatically terminated. Prevents resource accumulation in long-running containers. |
| **BannedAPI** | An API surface (e.g. `subprocess`, outbound network calls in v1) that is statically rejected during `VerificationGate` evaluation. The banned list is manifest-gated and version-tracked. |
| **KernelScope** | The isolation boundary for a `KernelSession`. One session per Claude session or worktree; sessions are never shared across profiles. |
| **VerificationEvidence** | The `ExecutionTrace` URN that proves a `VerifiedSkill` passed its gate. The skill record carries this reference; the evidence must be a real, recent trace, not a hypothetical. |

---

## Aggregates

### KernelSession (Root)

The `KernelSession` is the primary consistency boundary for this domain. It is the live runtime context within which all code execution and skill verification occurs.

**Identity**: `urn:agentbox:kernel:<session-pubkey>:<short-id>` — minted through `management-api/lib/uris.js`, following the ADR-013 grammar. `session-pubkey` is the hex pubkey of the owning agent session; `short-id` is a short random token unique within that session.

**Lifecycle states**:

```
Cold → Starting → Live → Idle → Terminated
                   ↑        ↓
                   └── (reset) ──┘

Cold      : KernelSession URN allocated, kernel process not yet started
Starting  : kernel process spawning, IPython kernel initialising
Live      : ready to accept exec calls; variables persist between calls
Idle      : no exec call received within idle-timeout window; still alive
Terminated: KernelSession stopped; URN cannot be reused
```

**Operations**:

| Operation | Pre-condition | Post-condition | Events emitted |
|---|---|---|---|
| `spawn(profile)` | State is `Cold`; `BootstrapCompleted` received | State is `Starting` → `Live` | `KernelStarted` |
| `exec(code)` | State is `Live` or `Idle` | Returns `ExecutionTrace`; state is `Live` | `ExecCompleted` |
| `inspect()` | State is `Live` | Returns variable name/type/value summary | — |
| `list_vars()` | State is `Live` | Returns dict of current namespace bindings | — |
| `reset()` | State is `Live` or `Idle` | Kernel namespace cleared; state remains `Live` | — |
| `interrupt()` | State is `Live` (exec in flight) | Running cell interrupted; state returns to `Live` | — |
| `install_pkg(name)` | State is `Live`; name in manifest allowlist | Package available in kernel namespace | — |
| `terminate(reason)` | Any non-`Terminated` state | Kernel process stopped; state is `Terminated` | `KernelTerminated` |

**Invariants**:

- I01: A `Terminated` `KernelSession` cannot transition to any other state. A new session requires a new identity.
- I02: `exec` is atomic with respect to `interrupt`: either the cell completes and returns an `ExecutionTrace`, or the interrupt fires and the kernel returns to `Live` with an interrupted `ExecutionTrace`. Enforced by the MCP server process: `kernel.exec` blocks the dispatch handler until completion or SIGINT; `kernel.interrupt` sends SIGINT and `kernel.exec` raises `KernelInterruptedError`. Tested by `tests/code-harness/kernel-interrupt.sh`.
- I03: `install_pkg` only succeeds if `[skills.code_interpreter].allow_pip_install = true` AND the package name appears in the `[skills.code_interpreter].pip_allowlist` manifest list. Unlisted packages are rejected without contacting any external index — installation reads from a pre-built local wheelhouse only (see ADR-018 §Package install policy).
- I04: Idle timeout (manifest-gated, default 300 s) terminates the kernel automatically. The `KernelTerminated` event is emitted with `reason: "idle"`.

---

### ExecutionTrace

`ExecutionTrace` is an immutable value-object-with-identity that records the outcome of one `exec` call. It is the canonical evidence record for this domain. Nothing downstream (lesson distillation, skill verification, observability) is permitted to reason about an execution outcome other than via its trace.

**Identity**: `urn:agentbox:trace:<kernel-short-id>:<seq>` — monotonically incrementing sequence number within the owning kernel.

**Fields**:

| Field | Type | Notes |
|---|---|---|
| `code_hash` | `sha256-12-<hex>` | First 12 hex chars of SHA-256 of the submitted code. Not the full code body (privacy). |
| `stdout` | `string` | Captured stdout of the cell. |
| `stderr` | `string` | Captured stderr; non-empty does not imply failure (many libraries write to stderr). |
| `exception` | `ExceptionRecord \| null` | `null` on clean exit. `ExceptionRecord` has `type`, `message`, `traceback_lines[]`. |
| `last_value_repr` | `string \| null` | `repr()` of the final expression value; `null` if the cell ends with a statement or raises. |
| `duration_ms` | `number` | Wall-clock time from cell start to return. |
| `started_at` | ISO-8601 | Timestamp at cell start. |

**Invariants**:

- I05: `ExecutionTrace` records are immutable once written. Trace records written to the audit JSONL are append-only (filesystem convention enforced by `O_APPEND` on file open). Trace evidence written to RuVector for lesson distillation uses URN keys with a write-once policy: collision-check before write via `memory_retrieve(key)` returning empty; if a duplicate URN is detected, the write is refused and a `TraceWriteCollision` event is emitted.
- I06: Each `exec` call emits exactly one OTLP span (ADR-005 observability middleware). The span carries the trace URN as an attribute.
- I07: The full submitted code body is never written to the default span or the default log line. It is available only in the debug exporter when `[observability].log_level = "debug"` is set.

---

### DistilledLesson

A `DistilledLesson` is the output of one ExpeL distillation pass over a completed trajectory. It is a structured, scoped, confidence-weighted natural-language rule that generalises from that trajectory to future tasks of similar character.

**Identity**: `urn:agentbox:memory:<scope>:lesson-<short-hash>` — `scope` is a kebab-case task category (e.g. `file-io`, `data-transform`); `short-hash` is a sha256-12 of the rule text at write time.

**Fields**:

| Field | Type | Notes |
|---|---|---|
| `rule` | `string` | The distilled natural-language rule. Concise; typically 1-3 sentences. |
| `scope` | `string` | Task category that scopes retrieval at dispatch time. |
| `evidence_trajectory_id` | `string` | URN or opaque ID of the trajectory from which this lesson was extracted. |
| `confidence` | `number` | Scalar in [0, 1]. Decremented on contradiction. |
| `source_agent` | `did:nostr:<pubkey>` | Identity of the agent whose trajectory produced this lesson. |
| `created_at` | ISO-8601 | Write timestamp. |

**Invariants**:

- I08: A lesson's `evidence_trajectory_id` must reference a trajectory that reached a terminal state (success or explicit failure). Interrupted trajectories do not produce lessons.
- I09: Lessons sourced from non-execution-grounded reflection (i.e., produced without at least one `ExecutionTrace` in the source trajectory) are rejected at write time by the distillation pipeline.
- I10: `LessonConfidence` is decremented by at least 0.1 when a subsequent `ExecutionTrace` in the same scope contradicts the lesson's rule. A `DistilledLesson` reaching confidence ≤ 0.1 is demoted to `suppressed` status and excluded from dispatch-time retrieval.

---

### VerifiedSkill

A `VerifiedSkill` is an executable code function that has passed the `VerificationGate`. It is the primary accumulation artefact of the Voyager-style skill library.

**Identity**: `urn:agentbox:skill:<scope>:<name>` — `scope` as above; `name` is the function name, normalised to snake\_case.

**Fields**:

| Field | Type | Notes |
|---|---|---|
| `signature` | `string` | Python function signature (name + typed parameters + return annotation). |
| `body_python` | `string` | Full Python function body, self-contained. |
| `assertions` | `string[]` | List of assertion statements verified against the function. Each must pass clean. |
| `examples` | `ExampleCall[]` | At least one example: `{ args, kwargs, expected_repr }`. Must execute without exception. |
| `verified_by` | `string` | URN of the `ExecutionTrace` that confirmed gate passage. |
| `embed_text` | `string` | Natural-language description used for semantic retrieval from RuVector. |
| `provenance` | `SkillProvenance` | `{ agent_did, trajectory_id, verified_at }`. |
| `scope` | `string` | Task category for retrieval scoping. |

**Invariants**:

- I11: A skill is only written to the library if all its `assertions` execute clean in a `KernelSession` AND at least one `examples` entry runs without exception. Both checks must be performed in the same `KernelSession` against the `body_python` as loaded.
- I12: The function body is statically scanned for BannedAPI references before kernel evaluation begins. Any reference to a BannedAPI (default: `subprocess`, `socket`, `urllib`, `requests`, `os.system` in v1) causes immediate rejection without entering the kernel. The BannedAPI list is manifest-gated under `[skills.code_interpreter].banned_apis`. Implementation status: `mcp/code-interpreter/sandbox_check.py` is a Phase 1 deliverable in ADR-018 §Implementation layout. Until shipped, candidate-skill writes are blocked at runtime by ADR-019 §VerificationGate (no skill writes are attempted before `sandbox_check.py` exists).
- I13: Every `VerifiedSkill` carries a `provenance` record. Skills without provenance cannot be written.
- I14: The `verified_by` field must reference a real, recent `ExecutionTrace` URN that exists in the current session's trace sequence. A skill cannot be written citing a hypothetical or fabricated trace URN. Enforced by ADR-019 §VerificationGate step 2.5: the `verified_by` URN must resolve via `memory_retrieve` to an `ExecutionTrace` record younger than `[skills.voyager_skill_library].max_evidence_age_s` (default 3600). Stale or missing evidence rejects the skill.
- I15: `VerifiedSkill` records are immutable. A new version is written as a new URN with monotonically increasing version suffix (`urn:agentbox:skill:<scope>:<name>:v<n>`). Old versions are retained until archived per the retention policy (see ADR-019 §Skill versioning).

---

## Events (operator-visible)

| Event | Trigger | Key Payload Fields |
|---|---|---|
| `KernelStarted` | `Cold → Live` transition | `session_urn`, `profile`, `kernel_type` ("ipython"), `started_at` |
| `KernelTerminated` | Any state → `Terminated` | `session_urn`, `reason` ("session-end" \| "idle" \| "oom" \| "crash" \| "interrupt-timeout"), `duration_s` |
| `ExecCompleted` | Per `exec` call | `trace_urn`, `duration_ms`, `exit_kind` ("clean" \| "exception" \| "interrupted"), `code_hash` |
| `LessonDistilled` | ExpeL post-task step | `lesson_urn`, `scope`, `confidence`, `source_agent`, `trajectory_id` |
| `SkillVerified` | `VerificationGate` passes | `skill_urn`, `verifier_kernel_urn`, `trace_urn`, `scope` |
| `SkillRejected` | `VerificationGate` fails | `candidate_hash`, `failure_mode` ("assertion-fail" \| "example-fail" \| "banned-api" \| "no-provenance"), `detail` |
| `DegradedExecution` | Kernel unreachable, call attempted | `fallback_path` ("pytorch-ml-script-mode"), `original_call_hash`, `reason` |
| `TraceWriteCollision` | Duplicate `ExecutionTrace` URN detected on RuVector write attempt | `trace_urn`, `session_urn` — write refused; existing trace retained |
| `LessonRedactionFailed` | `PrivacyFilterPort` unavailable at lesson write time | `lesson_scope`, `trajectory_id` — lesson dropped, not written without redaction |

All events are emitted through the ADR-005 observability middleware. Events are plain domain events in JSON; DDD-004 JSON-LD encoding is applied as an opt-in surface when `[linked_data.code_execution] enabled = true` in `agentbox.toml`.

---

## Ports (consumed)

| Port | Direction | Counterpart | Contract |
|---|---|---|---|
| **VectorMemoryPort** | Outbound (writes + reads) | RuVector context | Semantic search and store in two namespaces only: `code-harness-lessons` (for `DistilledLesson`) and `code-harness-skills` (for `VerifiedSkill`). Uses `mcp__claude-flow__memory_store` and `mcp__claude-flow__memory_search` exclusively — never raw SQL. |
| **BootstrapStatePort** | Inbound (event subscription) | DDD-001 Immutable Bootstrap | Kernel `spawn` is gated: until `BootstrapCompleted` is observed, any `spawn` call is queued. This prevents kernel startup racing the entrypoint filesystem setup. |
| **ObservabilityMiddlewarePort** | Outbound (wraps every dispatch) | ADR-005 | Every `CodeInterpreterDispatch` is wrapped by the ADR-005 middleware. One span, one log line, one metrics increment per call. |
| **SkillDispatchPort** | Outbound (read model exposure) | Skill-router context | Exposes `select(task_description, scope) → [VerifiedSkill]` via a RuVector semantic search over `code-harness-skills`. The skill-router context reads from this port; it does not write to the skill library. |
| **PrivacyFilterPort** | Outbound | ADR-008 | Kernel `stdout` and `stderr` pass through the privacy filter before being written to the audit log. The full trace (including code body in debug mode) is redacted to remove any PII patterns before export. |
| **LinkedDataPort** | Outbound (opt-in) | DDD-004 | When `[linked_data.code_execution] enabled = true`, `LessonDistilled` and `SkillVerified` events are encoded as JSON-LD before federation. The context document is pinned at build time via `lib/linked-data-contexts.nix`. |

---

## Anti-Corruption Layer

The kernel MCP server (`mcp/code-interpreter-mcp/`) exposes a MCP JSON-RPC 2.0 tool surface. The domain expresses operations as typed method calls on `KernelSession`; the adapter at `mcp/code-interpreter-mcp/` translates between the two.

**Wire → domain translation** (canonical 6-tool surface, per ADR-018 §Wire contract):

| MCP `tools/call` shape | Domain operation | Adapter responsibility |
|---|---|---|
| `{ name: "kernel.exec", arguments: { code, session_id } }` | `KernelSession.exec(code)` | Resolve `session_id` to `KernelSession` URN; allocate new session if absent; return `ExecutionTrace` as structured JSON. |
| `{ name: "kernel.list_vars", arguments: { session_id } }` | `KernelSession.list_vars()` | Return dict of current namespace bindings; surface as MCP `content: [{ type: "text", text: ... }]`. |
| `{ name: "kernel.inspect", arguments: { session_id } }` | `KernelSession.inspect()` | Return variable name/type/value summary; surface as MCP `content: [{ type: "text", text: ... }]`. |
| `{ name: "kernel.reset", arguments: { session_id } }` | `KernelSession.reset()` | Clear kernel namespace; confirm via empty `content` block. |
| `{ name: "kernel.interrupt", arguments: { session_id } }` | `KernelSession.interrupt()` | Send SIGINT to the running cell; kernel returns to `Live` with an interrupted `ExecutionTrace`. Enforces I02 atomicity guarantee. |
| `{ name: "kernel.install_pkg", arguments: { name, session_id } }` | `KernelSession.install_pkg(name)` | Validate name against manifest allowlist before forwarding to kernel. Reject with MCP error code `-32602` if not allowed. |

**Schema drift handling**: Each tool definition carries a `protocol_version` string field. The adapter reads this field on every call. If the version received does not match the adapter's compiled version, the call is rejected with a `DegradedExecution` event and an MCP error before reaching the domain. Downstream consumers (sparc:coder, CodeAct skill) see only domain operations; they are shielded from MCP wire-format changes.

**Session management**: The adapter maintains a per-profile in-memory registry mapping `session_id` (opaque client-supplied token, typically the Claude session ID) to `KernelSession` URN. This registry is local to the adapter process and is not persisted — sessions do not survive a kernel MCP server restart. On restart, all `KernelSession` states are `Cold`; clients must re-establish their sessions. This is by design: kernel state is ephemeral; only lessons and verified skills (stored in RuVector) are durable.

**Stdio transport**: The kernel MCP communicates via stdio (consistent with the 18-MCP pattern in `skills/mcp.json`). The adapter spawns the IPython kernel subprocess and bridges MCP JSON-RPC over its stdio channels. No network port is opened by the kernel itself.

---

## Domain Rules (cross-aggregate)

- R01: A `DistilledLesson` may only be written from a trajectory whose terminal state has been observed. "Observed" means the task's `post-task` hook fired with an explicit `success` or `failure` outcome. An interrupted or abandoned trajectory yields no lessons.
- R02: A `VerifiedSkill` body may not call another unverified skill by name. The static scanner checks for function name references against the unverified candidate pool before `VerificationGate` evaluation.
- R03: ExpeL distillation runs as a post-task hook subscriber, in addition to (not replacing) the existing `hooks post-task` processing. The distillation call is fire-and-forget relative to the main task completion path; failures in distillation are logged and emit no blocking error.
- R04: When the skill-router context retrieves `DistilledLesson` records at task start, they are injected as hints in the dispatch prompt. They are never asserted as hard rules. An agent may observe a lesson and choose not to apply it.
- R05: When ADR-018 kernel mode is disabled (`[skills.code_interpreter] enabled = false`), this domain emits only `DegradedExecution` events on any CodeAct call. No other events are emitted. Lesson distillation continues via text-only trajectory analysis (without execution traces) at reduced confidence.

---

## Migration and Coexistence

**Existing hooks**: The `claude-flow hooks post-task` pipeline continues to run unchanged. The ExpeL distillation step is an additional subscriber registered after existing post-task handlers; it does not modify or replace them.

**pytorch-ml coexistence**: The `pytorch-ml` skill continues to handle Python script-mode execution for ML workloads that do not require a persistent kernel (single-shot GPU training scripts, evaluation runs). `CodeAct` invokes the kernel MCP for interactive, stateful execution and degrades to `pytorch-ml` script-mode on kernel unavailability. There is no overlap: `pytorch-ml` is stateless script execution; the kernel MCP is stateful interactive execution.

**Existing orchestrators**: `sparc:code`, `deepseek-reasoning`, and `build-with-quality` remain orchestrators above this domain. They invoke the CodeAct loop by calling the kernel MCP tool directly; no changes to their internal logic are required. The skill-router context may optionally prepend retrieved `VerifiedSkill` bodies into the prompt context for these orchestrators.

**Phased rollout**: ADR-018 (kernel MCP) ships first and is gated by `[skills.code_interpreter] enabled = true`. ADR-019 (lesson distillation + skill library) is gated by `[features.expel_lesson_extraction] enabled = true` and `[skills.voyager_skill_library] enabled = true` respectively, and depends on ADR-018 being enabled for execution-grounded lessons. The DDD-004 JSON-LD port for this domain is gated separately by `[linked_data.code_execution] enabled = true`.

---

## Open Questions

1. **Multi-agent kernel sharing**: The current model is one `KernelSession` per Claude session or worktree. In a hierarchical-mesh swarm where multiple agents collaborate on a single task, should the orchestrator agent own a shared kernel that sub-agents can `exec` into, or should each sub-agent have its own session? Shared sessions simplify variable passing but introduce contention and isolation concerns. This question is deferred to ADR-018 authorship; the invariants here (I01–I04) are intentionally scoped to single-session ownership and do not preclude a multi-session extension.

2. **Lesson contradiction detection**: I10 requires `LessonConfidence` to be decremented when a trace contradicts a lesson. **Closed in ADR-019 §Contradiction detection**: LLM-judge sampled at recall time (1/10 retrievals), decrement 0.1 per contradiction, floor at 0.3 triggers archive. The contradiction-detection step uses a sampled LLM judge that compares trace outcome against lesson rule text; a cheaper heuristic (scope + outcome polarity matching) is reserved for v2 if cost proves excessive.

3. **VerifiedSkill versioning**: When an improved version of a skill is written (same name, same scope, better implementation), should the old skill be retired or retained for provenance? **Closed in ADR-019 §Skill versioning and I15**: immutable versions, monotonic increments (`v<n>` suffix), archive after 30 days into `code-harness-skills-archive` namespace.

4. **Banned-API list governance**: I12 defines a static banned list (`subprocess`, `socket`, `urllib`, `requests`, `os.system` in v1). This list will need to evolve as the skill library matures — some skills legitimately need controlled network access (e.g. HTTP to localhost services). A per-skill `capabilities: []` declaration, gated by manifest, would allow controlled exceptions without weakening the default. This is deferred to ADR-019.

5. **Privacy filter interaction with trace storage**: Traces are stored in RuVector as part of lesson distillation evidence. The `PrivacyFilterPort` redacts stdout/stderr before audit-log export, but the RuVector write path is not the audit log. **Closed in ADR-019 §Privacy filter on RuVector write path**: yes, mandatory — all `ExecutionTrace` evidence and `DistilledLesson` records pass through `PrivacyFilterPort` before being written to RuVector, with the failure mode of dropping the lesson if the filter is unavailable.

6. **Confidence floor and lesson retirement**: I10 specifies a demotion threshold of confidence ≤ 0.1 for suppression. It does not specify whether suppressed lessons are ever deleted, or whether they persist indefinitely as suppressed records. Indefinite retention provides an audit trail but accumulates storage and retrieval noise over long-running containers. A TTL or explicit retirement policy is needed.

---

## References

| Reference | Notes |
|---|---|
| ADR-018 | Code Interpreter MCP and CodeAct loop — decision record (not yet authored at DDD-005 draft time; this DDD informs its authorship). |
| ADR-019 | ExpeL lesson distillation pipeline and Voyager skill library — decision record (not yet authored at DDD-005 draft time). |
| PRD-008 | Product requirements for code execution and experiential learning (not yet authored at DDD-005 draft time). |
| DDD-001 | Immutable Bootstrap domain — supplies `BootstrapCompleted`, which gates `KernelSession.spawn`. |
| DDD-002 | Runtime Contract domain — governs the kernel service's liveness and readiness probes. |
| DDD-004 | Linked-Data Interchange domain — opt-in JSON-LD encoding of `LessonDistilled` and `SkillVerified` events. |
| ADR-005 | Pluggable adapter architecture and observability middleware — wraps every `CodeInterpreterDispatch`. |
| ADR-008 | Privacy filter — applied to trace stdout/stderr before audit-log export. |
| ADR-013 | Canonical URI grammar — all identities in this domain follow `urn:agentbox:<kind>:[<scope>:]<local>`, minted via `management-api/lib/uris.js`. |
| arxiv:2402.01030 | "Executable Code Actions Elicit Better LLM Agents" (CodeAct) — +20% success rate vs JSON actions; source of the CodeAct Loop pattern. |
| arxiv:2305.16291 | "Voyager: An Open-Ended Embodied Agent with Large Language Models" — 3.3x unique items, 15.3x faster milestone completion; source of the VerifiedSkill library pattern. |
| arxiv:2412.15118 | "Reasoning Through Execution: ORPS" — +26.9% correctness, +42.2% code efficiency; source of the trace-as-reward and tree-search execution pattern. |
| ExpeL (Zhao et al., 2024) | Experiential learning via trajectory lesson extraction — source of the `DistilledLesson` and `LessonConfidence` pattern. Cited in convergence-shortlist `paper-T4-expel`. |
