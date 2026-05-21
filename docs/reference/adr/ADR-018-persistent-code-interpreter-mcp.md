# ADR-018: Persistent code-interpreter MCP and CodeAct skill

**Status:** Draft
**Date:** 2026-05-20
**Author:** Agentbox team
**Supersedes:** n/a
**Related:** ADR-005 (Pluggable adapters), ADR-015 (MCP RuVector mandate), ADR-007 (Runtime contract and container hardening), PRD-008 (Code-as-harness integration), DDD-005 (Code-execution domain)

---

## TL;DR for newcomers

*Skip if you already know why a persistent kernel beats per-call Bash and `python -c`.*

Every Bash invocation in agentbox starts a fresh shell. Every `python -c` discards all state on exit. The agent cannot accumulate intermediate results, reuse computed data frames, or observe the exception trace of a prior step without re-running everything from scratch. Four independent papers across three survey tiers converge on the same missing primitive: a stateful, sandboxed code interpreter that persists across tool calls within a session. Program of Thoughts (arxiv:2211.12588) gains +12 percentage points over chain-of-thought on eight maths and financial-QA benchmarks by delegating arithmetic to a Python interpreter. Chain of Code (arxiv:2312.04474) reaches 84 % on BIG-Bench Hard — a +12 pp gain — by mixing real interpreter execution with an LM emulator fallback for semantic sub-tasks. CodeAct (arxiv:2402.01030) shows +20 % success rate across 17 LLMs by collapsing all agent actions into a single persistent Python interpreter loop. ORPS (arxiv:2412.15118) adds +26.9 % correctness and +42.2 % code efficiency via execution-gated tree-search scored by runtime metrics. All four patterns require the same infrastructure: a kernel that lives for the duration of a session, not the duration of a single subprocess call.

**If you remember only one thing:** a persistent IPython kernel per session, exposed as an MCP server, is the single primitive that unlocks four research patterns concurrently and is a hard dependency for two further shortlist items (execution-gated tree-search, PoE-World modeller).

---

## Context

### The problem with the status quo

Agentbox's 89 existing skills execute code via three routes, all stateless:

| Route | Where used | Limitation |
|---|---|---|
| `Bash(python -c "…")` | ad-hoc reasoning steps | No state between calls; subprocess exit discards everything |
| `pytorch-ml` skill | ML experimentation | Script-file based; each run is an independent subprocess |
| `cuda` skill | Kernel optimisation | Targeted at CUDA tuning, not general stateful execution |
| `sparc:code` | Plan-then-code orchestration | Orchestrator, not executor; iterates by re-prompting, not by inspecting kernel state |

The consequence is that the agent must either re-derive all intermediate state on every tool call, or serialise results to disk and reload them — neither of which is natural, and both of which break the write→exec→observe→revise loop that all four papers identify as the key agentic primitive.

### Why three further shortlist items depend on this

The convergence-shortlist dependency graph is explicit:

```
Persistent code-interpreter MCP
    ├── Execution-gated tree-search skill (hard dependency — cannot score candidates without kernel)
    └── PoE-World compositional modeller (hard dependency — expert functions must be runnable)
```

ExpeL and Voyager do not hard-depend on the kernel at the data-flow level, but Voyager's verified skill library gate (assertions must pass under the kernel MCP) becomes possible only once the kernel exists.

### What the field has converged on

| Paper | Year | arXiv | Headline result |
|---|---|---|---|
| Program of Thoughts (PoT) | 2022/2023 | 2211.12588 | +12 pp over CoT on 8 maths/financial-QA benchmarks; SoTA with self-consistency |
| Chain of Code (CoC) | 2023/2024 | 2312.04474 | 84 % on BIG-Bench Hard, +12 pp over chain-of-thought; LMulator handles semantic steps |
| CodeAct | ICML 2024 | 2402.01030 | +20 % success rate vs JSON/text actions across 17 LLMs; unified action space |
| ORPS | 2025 | 2412.15118 | +26.9 % correctness, +42.2 % code efficiency; execution-gated tree-search |

None of these results depends on fine-tuning. All are inference-time patterns. All share the same enabling assumption: the interpreter maintains state across calls within a single task trajectory.

### What agentbox already has nearby, and why it is not the same primitive

- **`pytorch-ml`** — script-based; spawns a new Python subprocess per invocation; no cross-call state.
- **`cuda`** — targeted at GPU kernel performance profiling; not a general-purpose interpreter.
- **`sparc:code`** — coordinates the writing of code and its submission to a subprocess; does not expose interpreter state to the agent between turns.
- **`Bash` tool** — per-call shell; each call is a new PID; no shared Python namespace.
- **`deepseek-reasoning`** — an LLM consultant, not a code executor.
- **`browsercontainer`** — provides a sandboxed browser execution surface (Chrome CDP), not a Python kernel.

None of these is a persistent, stateful Python kernel exposed as structured MCP tools. That is the gap.

---

## Decision

The following decisions are made in aggregate. They are individually reversible via manifest gate.

1. **One IPython/Jupyter kernel per Claude session**, spawned lazily on the first `kernel.exec` tool call. The kernel process runs as devuser within the existing container cgroup budget. There is no daemon; the session-end hook kills the kernel process.

2. **MCP stdio server** (`mcp/code-interpreter/server.py`, Python, uses the `mcp` SDK plus `jupyter_client`). The server follows the same layout convention as `mcp/consultants/` established in ADR-011. It is declared in `skills/mcp.json` and in the top-level `mcp/mcp.json` behind its manifest gate.

3. **Six tools** exposed by the MCP server (see Wire Contract section below).

4. **A thin `codeact` SKILL.md** that names the kernel MCP server, describes when to choose it over `sparc:code` / `pytorch-ml`, and provides three to five in-context learning exemplars demonstrating the write→exec→observe→revise loop pattern. The skill itself contains no Python; it is prompt scaffolding only.

5. **Trace-as-reward**: the primary verification signal is the tuple (stdout, stderr, exception type, last-expression value) returned by `kernel.exec`. There is no LLM judge in the critical path. Verification is execution-grounded.

6. **Fail-closed semantics**: if the kernel MCP server cannot start (missing `jupyter_client`, port conflict, cgroup limit), the `codeact` skill MUST fall back to `pytorch-ml` script mode and emit a structured degradation warning. It MUST NOT silently no-op or present a clean tool surface backed by a dead kernel. This mirrors the ADR-015 fail-closed principle.

---

## Architecture

### Wire contract

Six tools, one server. Shape mirrors ADR-011's three-tool-per-consultant pattern, extended for stateful execution.

| Tool | Signature | Returns | Notes |
|---|---|---|---|
| `kernel.exec` | `(code: str, timeout_s: int = 30)` | `{stdout, stderr, result, exception, duration_ms, cell_id}` | Executes `code` in the running kernel; `result` is the last expression value (repr), `exception` is null or `{type, message, traceback}` |
| `kernel.list_vars` | `()` | `{vars: [{name, type, size_hint}]}` | Lists all names in the kernel namespace with type and, for ndarray/DataFrame, a shape hint; no serialisation of values |
| `kernel.inspect` | `(name: str)` | `{name, type, repr, shape?, dtype?, len?}` | Richer introspection for a single variable; calls `inspect.getmembers` pattern |
| `kernel.reset` | `()` | `{ok: bool}` | Restarts the kernel; clears all namespace state; does not kill the MCP server process |
| `kernel.interrupt` | `()` | `{ok: bool}` | Sends SIGINT to the running cell; safe to call mid-`kernel.exec` |
| `kernel.install_pkg` | `(name: str)` | `{ok: bool, version?, error?}` | Installs a package into the kernel's venv from the **local wheelhouse** (network is off — see §Package install policy); requires `[skills.code_interpreter].allow_pip_install = true` AND name in `pip_allowlist` AND wheel present in `/var/lib/agentbox/code-interpreter-wheelhouse/`; `ok=false` with descriptive `error` otherwise |

Full JSON Schema published at `agentbox/schemas/mcp/code-interpreter-v1.json`.

### Kernel lifetime model

```
Session start
    │
    ▼
First kernel.exec call
    │
    ▼
server.py spawns IPython kernel via jupyter_client.KernelManager.start_kernel()
    │  (lazy — no kernel process until first use)
    │
    ▼
Kernel runs for the lifetime of the MCP server process
    │
    │   kernel.reset()  ──►  restart_kernel()  (process is replaced, namespace cleared)
    │   kernel.interrupt() ─► interrupt_kernel() (SIGINT to running cell)
    │
    ▼
Session end hook fires (claude-flow hooks session-end)
    │
    ▼
MCP server receives SIGTERM; calls kernel_manager.shutdown_kernel(now=True)
```

**Per-agent isolated kernels.** The default is one kernel per Claude session (one server process per `claude` invocation). When a swarm runs multiple agents concurrently and they each receive their own MCP server spawn (standard Claude Code behaviour with per-agent tool instances), isolation is automatic. The `--isolated-kernel` opt-in in `agentbox.toml` has no meaning in the per-session-per-process model; it is reserved for a future shared-kernel multi-agent pattern that is explicitly out of scope for v1.

**Idle timeout enforcement.** An `idle_watchdog` thread inside the MCP server process polls `time.monotonic() - last_exec_time` every 30 seconds. When the elapsed idle time exceeds `[skills.code_interpreter].idle_timeout_s` (default 1800), the watchdog calls `kernel_manager.shutdown_kernel(now=True)`. On the next `kernel.exec` call after shutdown, the server spawns a fresh kernel (lazy spawn, same as first-call behaviour) and returns `{"ok": false, "error": "kernel_restarted"}` to notify the coordinator. This satisfies DDD-005 invariant I04 without requiring supervisord cron or external heartbeat infrastructure.

### Sandbox boundary

The container is already the primary isolation boundary (ADR-007). Within the container, the kernel runs:

- As `devuser` (same user as Claude Code), matching the existing cgroup budget.
- Under the default `RLIMIT_AS` and `RLIMIT_CPU` set by the container hardening profile.
- With no network access (the server sets `JUPYTER_NO_NETWORK=1` via the kernel environment).
- Without capability to escalate privileges (`no-new-privileges` is already set in the runtime contract).

An nsjail wrapper is considered but deferred to a follow-up ADR for attacker-controlled code scenarios. For v1, the assumption is that code executed in the kernel originates from the agent (not from untrusted user input), which is the same trust model as the existing `Bash` tool.

### Package install policy

**Network is off inside the kernel.** `JUPYTER_NO_NETWORK=1` is set at spawn and a `requests` / `urllib` monkey-patch additionally blocks outbound sockets from agent-authored code. Consequently `pip install <pkg>` against PyPI is **not** possible from within the kernel and is **not** the mechanism by which packages enter the venv.

Installation reads from a **pre-built local wheelhouse** at `/var/lib/agentbox/code-interpreter-wheelhouse/` (Nix-baked at image build time, gated by `[skills.code_interpreter].enabled = true`). Both initial venv hydration and runtime `kernel.install_pkg` calls invoke pip with `--no-index --find-links=/var/lib/agentbox/code-interpreter-wheelhouse/` so pip never touches the network.

- **Always available** (hydrated into the venv at MCP server startup from the wheelhouse): `numpy`, `pandas`, `scipy`, `sympy`, `matplotlib`, `scikit-learn`, `requests`. (`requests` is included because some allow-listed libraries import it transitively at import-time; it is non-functional inside the kernel because network is off.)
- **Allow-list extras** (manifest-gated via `[skills.code_interpreter].pip_allowlist`; additionally requires `[skills.code_interpreter].allow_pip_install = true`): packages whose wheels are present in the wheelhouse AND whose names are on the allow-list may be installed at runtime via `kernel.install_pkg`. Installing a package not on the allow-list, or one whose wheel is absent from the wheelhouse, returns `{ok: false, error: "package not in manifest allow-list"}` or `{ok: false, error: "wheel not in local wheelhouse"}` respectively.
- **Blocked always:** packages whose names match `[subprocess, os.fork, socket, ctypes, cffi]` or that transitively require them as a primary API surface. The block is enforced by a post-install check (`sandbox_check.py`, to be created in Phase 1 implementation) that imports the package and runs `ast.walk` over its `__init__` for obvious sandbox-escape patterns.

**If public-mirror access is ever needed** (it is not in v1, and no current Phase 1 acceptance criterion requires it), gate behind a new manifest key `[skills.code_interpreter].allow_public_mirror` (default `false`). Enabling it relaxes the wheelhouse-only constraint to `--index-url <mirror>` and explicitly opens an outbound egress hole — a decision worth a separate ADR.

### GPU access

v1: CPU-only. The `pytorch-ml` and `cuda` skills continue to own GPU access. A separate `code-interpreter-cuda-mcp` variant that passes the GPU device through to the kernel is deferred pending demand evidence. The manifest gate `[skills.code_interpreter].gpu = false` is the default and the only supported value in v1.

### Observability binding

ADR-005 §Observability applies in full. Every dispatch of every kernel MCP tool emits one OTLP span, one structured log line, and one metrics increment. Span names use the form `agentbox.mcp.code_interpreter.<op>` (dots for hierarchy, snake_case within each segment — consistent with the `[skills.code_interpreter]` TOML key and ADR-011 precedent).

| Tool | Span name | Log fields | Metrics |
|---|---|---|---|
| `kernel.exec` | `agentbox.mcp.code_interpreter.exec` | `tool, duration_ms, outcome, session_urn, code_hash` (code body only in debug exporter) | `agentbox_kernel_calls_total{tool="exec", outcome}`, `agentbox_kernel_duration_ms{tool="exec"}` |
| `kernel.list_vars` | `agentbox.mcp.code_interpreter.list_vars` | `tool, duration_ms, outcome, session_urn` | `agentbox_kernel_calls_total{tool="list_vars", outcome}`, `agentbox_kernel_duration_ms{tool="list_vars"}` |
| `kernel.inspect` | `agentbox.mcp.code_interpreter.inspect` | `tool, duration_ms, outcome, session_urn` | `agentbox_kernel_calls_total{tool="inspect", outcome}`, `agentbox_kernel_duration_ms{tool="inspect"}` |
| `kernel.reset` | `agentbox.mcp.code_interpreter.reset` | `tool, duration_ms, outcome, session_urn` | `agentbox_kernel_calls_total{tool="reset", outcome}`, `agentbox_kernel_duration_ms{tool="reset"}` |
| `kernel.interrupt` | `agentbox.mcp.code_interpreter.interrupt` | `tool, duration_ms, outcome, session_urn` | `agentbox_kernel_calls_total{tool="interrupt", outcome}`, `agentbox_kernel_duration_ms{tool="interrupt"}` |
| `kernel.install_pkg` | `agentbox.mcp.code_interpreter.install_pkg` | `tool, duration_ms, outcome, session_urn` | `agentbox_kernel_calls_total{tool="install_pkg", outcome}`, `agentbox_kernel_duration_ms{tool="install_pkg"}` |

Session-scoped gauge: `agentbox_kernel_sessions_active` (maintained by per-session spawn/shutdown lifecycle).

For `kernel.exec`, `outcome` ∈ {`ok`, `exception`, `timeout`, `interrupt`}. For all other tools, `outcome` ∈ {`ok`, `error`}. Span attributes for `kernel.exec` additionally include `code_hash` (SHA-256 of submitted code, hex, first 16 chars) and `cell_id`.

The code body is logged only when `[observability].debug_exporter = true` to avoid token-heavy log streams. The privacy filter (ADR-008) is applied at the `outbound` slot before code body appears in any exporter, when `[privacy_filter].enabled = true`.

### Persistence policy

v1: throwaway. Kernel namespace state is not snapshotted. If the agent needs to preserve intermediate results across sessions it must serialise them explicitly (e.g. `kernel.exec("df.to_parquet('/workspace/tmp/df.parquet')")`). A future ADR may add `kernel.snapshot()` → RuVector if demand warrants it.

### Manifest gates

```toml
[skills.code_interpreter]
enabled           = false          # default off; set true to activate
max_memory_mb     = 512            # kernel process RLIMIT_AS ceiling (advisory)
allow_pip_install = false          # set true to allow kernel.install_pkg
pip_allowlist     = []             # list of allowed package names when allow_pip_install = true
gpu               = false          # reserved; v1 always CPU-only
idle_timeout_s    = 1800           # default 30 min; W044 warns if < 300
```

Validator additions (new error codes extending ADR-005's registry):

| Code | Condition |
|---|---|
| `E042` | `skills.code_interpreter.allow_pip_install = true` requires `pip_allowlist` to be non-empty |
| `E043` | `skills.code_interpreter.enabled = true` requires `jupyter_client` available in the Nix environment (checked via `nix build .#pythonEnvCodeInterpreter`) |
| `W042` | `skills.code_interpreter.max_memory_mb` < 128 is accepted but warns that scientific packages (pandas, scipy) typically require ≥ 200 MB to import |
| `W044` | `skills.code_interpreter.idle_timeout_s` < 300 is accepted but warns that very short idle timeouts may interrupt long-running data workflows |

### Implementation layout

The following files are deliverables to be created in Phase 1 implementation; they do not exist yet.

```
mcp/code-interpreter/                        # (to be created in Phase 1 implementation)
├── server.py               # MCP stdio server; ~400 lines; jupyter_client KernelManager
├── frozen_requirements.txt # numpy pandas scipy sympy matplotlib scikit-learn requests
├── sandbox_check.py        # post-install AST scan for sandbox-escape patterns
└── README.md               # operator guide; kernel lifecycle; troubleshooting

skills/codeact/                              # (to be created in Phase 1 implementation)
└── SKILL.md                # when to choose, ICL exemplars (5 examples), skill-router entry

agentbox/schemas/mcp/
└── code-interpreter-v1.json  # JSON Schema for the six MCP tools (to be created in Phase 1 implementation)
```

The `server.py` is a self-contained Python script with no npm entanglement. It is packaged via the Nix `python3Packages.buildPythonApplication` derivation in `flake.nix`, gated under `pkgs.lib.optionalAttrs config.skills.code_interpreter.enabled`.

---

## Consequences

### Positive

- **Single primitive, four patterns unlocked.** PoT, CoC (with LMulator fallback), CodeAct, and ORPS all become expressible as SKILL.md overlays or post-task skill compositions, with no new infrastructure beyond the kernel MCP.
- **Trace-as-reward by default.** The agent receives execution-grounded feedback (stdout, exception, result) without an LLM judge, reducing hallucination risk in verification steps.
- **Hard dependency for tree-search skill.** ADR shortlist items 3 and 4 (execution-gated tree-search, PoE-World modeller) can now be built without a separate infrastructure prerequisite.
- **State accumulation enables realistic data workflows.** An agent can load a 1 GB parquet file once into a DataFrame and query it across multiple tool calls, which `python -c` cannot support.
- **Fits the existing MCP pattern.** Same stdio server shape as ADR-011 consultants, same Nix derivation style, same manifest gate pattern. No new concepts for operators.

### Negative

- **~80 MB RAM per idle kernel.** A session with the kernel activated consumes approximately 80 MB for the IPython kernel process at idle, rising to ~300–500 MB when scientific packages are imported. This must be accounted for in swarm configurations where multiple agents run concurrently.
- **One more process to monitor.** The MCP server and kernel are two additional processes in the supervisor tree per session. SIGTERM propagation must be reliable; a leaked kernel process is a resource drain.
- **Sandbox is advisory, not hermetic.** The container boundary is the primary isolation. The additional in-process network block and AST scan are heuristics. Attacker-controlled code execution is not a supported threat model in v1.
- **`kernel.install_pkg` is a supply-chain surface.** Even with an allow-list, a compromised package on PyPI is a risk. Mitigation: the allow-list must only contain packages with reproducible Nix hashes if the `allow_pip_install = false` default is overridden.
- **LMulator fallback for CoC pattern is not in v1.** The Chain of Code pattern's key differentiator — calling the LM emulator when real interpretation fails — requires the MCP server to make a back-channel call to Claude. This introduces a re-entrant tool call. Deferred to v2 pending MCP support for server-initiated LLM calls.

### Neutral

- The `pytorch-ml` skill is not deprecated. It remains the recommended path for multi-file ML training runs (scripts, sweep configuration, checkpoint management). The kernel MCP is for interactive exploration and single-task reasoning loops.
- The `sparc:code` orchestrator is not changed. It continues to coordinate plan-then-code flows; if a plan step requires persistent state it can invoke `codeact` as a sub-skill.

---

## Alternatives considered

### ChatGPT-style hosted code interpreter

- **Pros:** No infrastructure to operate; zero maintenance.
- **Cons:** Hosted execution outside the container trust boundary; no MCP; code and data leave the container; violates the agentbox security model (ADR-007, ADR-008).
- **Rejected.**

### Persistent IPython session via tmux pane

- **Pros:** Low implementation cost; IPython already available.
- **Cons:** No structured output; not addressable from Claude via MCP; output parsing is fragile; no timeout enforcement; no graceful shutdown via session hook.
- **Rejected.**

### Per-call `python -c` / `Bash` (status quo)

- **Pros:** No new infrastructure; already works.
- **Cons:** No state between calls; cannot accumulate variables, DataFrames, or model weights; forces the agent to re-derive or serialise/deserialise intermediate state manually; four research patterns are structurally inexpressible.
- **Rejected as primary path;** retained as the `pytorch-ml` degradation fallback.

### Full OpenHands sandboxed OS runtime (arxiv: openhands)

- **Pros:** Richer OS interaction (browser, file system, terminal, multiple language kernels); active open-source project.
- **Cons:** Large-cost infrastructure rewrite; requires a separate Docker-in-Docker container or VM; browsercontainer already covers the sandboxed browser surface; full OS sandbox is a platform pivot, not a skill addition; licence compatibility uncertain.
- **Rejected.** Explicitly listed as a non-candidate in the convergence shortlist for this reason.

### IPykernel over ZMQ with direct socket access from server.py

- **Pros:** Marginally lower latency than going through `jupyter_client.KernelManager`; avoids the Jupyter protocol overhead.
- **Cons:** `jupyter_client` is the stable, maintained abstraction; direct ZMQ requires agentbox to own kernel lifecycle management (heartbeat, restart, interrupt). Not worth the maintenance cost for a v1 server.
- **Rejected in favour of `jupyter_client`.**

---

## Rollout and rollback

### Phase 1 — manifest-gated, default off

Ship the kernel MCP server and `codeact` SKILL.md behind `[skills.code_interpreter].enabled = false`. The skill is visible in the SKILL-DIRECTORY but marked "requires manifest gate". Operators who opt in for evaluation set `enabled = true` in their local `agentbox.toml`.

Phase 1 acceptance is defined by PRD-008 §7 Track A criteria A1–A9. ADR rollout sections describe procedure (build, deploy, monitor), not thresholds.

### Phase 2 — default on in dev profile

Once acceptance criteria pass, flip `enabled = true` in the default dev profile `agentbox.toml`. The production profile retains `enabled = false` until a security review (sandbox boundary audit) completes.

### Rollback

Set `[skills.code_interpreter].enabled = false`. The `codeact` SKILL.md renders its routing section but emits a degradation warning directing the agent to `pytorch-ml` or `sparc:code`. No data migration is needed; there is no persistent kernel state.

---

## Open questions

1. **Kernel lifetime across multi-agent swarms.** If four swarm agents share one Claude session context but each receives its own MCP server spawn, do they each get a separate kernel? The per-session-per-process model says yes, but the session boundary in Claude's `Task` tool is not always well-defined. Needs clarification in DDD-005.

2. **LMulator (CoC fallback).** Chain of Code's key differentiator is the LM emulator that handles semantic steps the real interpreter cannot execute. Implementing this requires the kernel MCP server to invoke an LLM mid-execution. MCP does not currently have stable server-initiated LLM call semantics. This is the primary v2 unlock.

3. **GPU access policy.** If a future `code-interpreter-cuda-mcp` variant is added, it must not conflict with the `pytorch-ml` skill's existing GPU device management. The manifest must prevent both from holding GPU context simultaneously.

4. **State persistence across sessions.** The throwaway policy is correct for v1 but will be inadequate for long-running experiment workflows. A `kernel.snapshot()` → RuVector mechanism would require a new memory adapter method and a new RuVector namespace. The ExpeL/Voyager skill library (ADR-019) may provide the right integration point.

5. **Telemetry granularity.** Logging the full code body of every `kernel.exec` call in debug mode may expose sensitive data (API keys, credentials embedded in scripts). The privacy filter (ADR-008) must have an explicit rule for `agentbox.mcp.code_interpreter` spans before the debug exporter is enabled in any shared environment.

6. **Collision with `sparc:code` and `deepseek-reasoning` in skill-router.** The skill-router must not route simple code-generation tasks to `codeact` (which implies a running kernel) when a stateless `sparc:code` call would suffice. The skill-router routing section in `codeact/SKILL.md` must include clear "when NOT to choose this skill" guidance: tasks that do not require state accumulation, tasks where a single subprocess run is sufficient, and tasks where the kernel overhead (~80 MB, ~300 ms cold start) exceeds the benefit.

---

## Related files

- `mcp/code-interpreter/` — implementation (to be created in Phase 1 implementation)
- `skills/codeact/SKILL.md` — skill definition and ICL exemplars (to be created in Phase 1 implementation)
- `agentbox.toml` — `[skills.code_interpreter]` block
- `agentbox/schemas/mcp/code-interpreter-v1.json` — wire contract JSON Schema (to be created in Phase 1 implementation)
- `flake.nix` — `pythonEnvCodeInterpreter` derivation
- `scripts/agentbox-config-validate.js` — E042, E043, W042, W044
- `docs/reference/prd/PRD-008-code-as-harness-integration.md`
- `docs/reference/ddd/DDD-005-code-execution-domain.md`
- `docs/reference/adr/ADR-005-pluggable-adapter-architecture.md`
- `docs/reference/adr/ADR-015-mcp-ruvector-mandate.md`
- `docs/reference/adr/ADR-019-experiential-skill-learning.md`

## References

- Program of Thoughts Prompting — Chen et al. 2022 — https://arxiv.org/abs/2211.12588
- Chain of Code — Li et al. 2023 — https://arxiv.org/abs/2312.04474
- CodeAct: Executable Code Actions Elicit Better LLM Agents — Wang et al. 2024 — https://arxiv.org/abs/2402.01030
- ORPS: Reasoning Through Execution — Qin et al. 2025 — https://arxiv.org/abs/2412.15118
- jupyter_client documentation — https://jupyter-client.readthedocs.io/
- MCP Python SDK — https://github.com/modelcontextprotocol/python-sdk
