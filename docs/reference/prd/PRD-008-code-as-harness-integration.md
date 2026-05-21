# PRD-008: Code-as-Harness integration

**Status:** Draft v1
**Date:** 2026-05-20
**Repo:** [github.com/DreamLab-AI/agentbox](https://github.com/DreamLab-AI/agentbox)
**Related:** ADR-018 (Persistent code-interpreter MCP + CodeAct), ADR-019 (Experiential skill learning), DDD-005 (Code-execution and experiential-learning domain), PRD-001 (Capabilities and adapters), ADR-005 (Pluggable adapters), ADR-015 (MCP RuVector mandate)

## TL;DR for newcomers

*Skip if you already know why agentbox needs persistent code execution and experiential skill learning.*

Agentbox ships 89 skills and 18 MCP servers. None of them provide a persistent, stateful code interpreter that survives across tool calls. Every Bash invocation in the current harness drops its environment at exit: a variable assigned in one tool call is gone by the next. The consequence is that every code-execution pattern documented by independent research over 2023–2025 — Program of Thoughts (PoT), Chain of Code (CoC), CodeAct, and Outcome-Reward Process Supervision (ORPS) — either cannot be expressed at all in agentbox, or degrades to a weaker approximation via repeated shell spawns. Four tiers of a literature survey converge on the same primitive: a persistent Python kernel behind an MCP interface.

That foundational gap opens two further gaps. Agentbox has no mechanism to distil generalisable lessons from past task trajectories (ExpeL pattern): `hooks post-task --store-results true` records outcomes but does not extract cross-run rules into a searchable corpus. And agentbox has no verified skill library where successfully-executed, assertion-passing code functions are stored, indexed by embedding, and retrieved to bootstrap future tasks (Voyager pattern). Two additional capabilities — an Agent-Computer Interface MCP for autonomous repo-level bug-fixing (SWE-agent pattern) and an execution-gated tree-search orchestration skill (ORPS/Tree-of-Code pattern) — depend on the same kernel primitive.

This PRD specifies all six capabilities: what to build, in what order, and what to reject. The rejection list is as important as the build list.

**If you remember only one thing:** the persistent code-interpreter MCP is the single primitive that four independent research lines converge on; everything else in this PRD depends on it or is made substantially better by it.

For the deep version, keep reading.

---

## 1. Problem

### 1.1 The stateless shell problem

Agentbox's current code-execution surface is the Bash tool, which spawns a fresh shell for every call. Intermediate variables, imported modules, and in-memory state do not survive between calls. This is correct behaviour for the Bash tool's design, but it prevents any of the following research-validated patterns from operating as specified:

- **Program of Thoughts** (arxiv: 2211.12588): delegates arithmetic to an external Python interpreter while the LLM handles symbolic reasoning. Requires a kernel that persists the variable namespace across reasoning steps. Agentbox partial approximation: sparc:code chains Bash calls, losing state between steps. Measured lift foregone: +12% average over Chain-of-Thought on 8 benchmarks.
- **Chain of Code** (arxiv: 2312.04474): interleaves real Python execution with LM-emulated execution for steps the interpreter cannot handle. Requires a kernel that can switch between real and simulated execution mid-chain. No agentbox approximation exists. Measured lift foregone: +12% on BIG-Bench Hard (84% vs 72%).
- **CodeAct** (arxiv: 2402.01030): unifies all agent actions into executable Python, running inside a persistent interpreter. Multi-turn revision of prior actions upon new observations collapses tool-call and reasoning into a single executable artefact. Agentbox approximation: sparc:coder and swarm agents use JSON message-passing, not shared interpreter state. Measured lift foregone: +20% success rate over JSON/text action formats across 17 LLMs on API-Bank benchmark.
- **ORPS tree-search** (arxiv: 2412.15118): generates N candidate programs, executes each, scores by execution metrics, selects the best branch. Requires fast repeated kernel invocations without cold-start overhead. Approximation via repeated Bash spawns is 10–30x slower and stateless between branches. Measured lift foregone: +26.9% correctness, +42.2% code efficiency across 5 models and 3 benchmarks.

### 1.2 The lesson-amnesia problem

`hooks post-task --store-results true` records task outcomes in RuVector under the `tasks` namespace. It does not extract generalisable rules. An agent that repeatedly fails a class of task (e.g. "write a correct regex for multi-line YAML front-matter") accumulates outcome records but never synthesises the lesson "always test regex against edge cases before committing". The ExpeL paper (arxiv: 2308.10144) demonstrates that this distillation step — trajectory in, reusable natural-language insight out — produces monotonic accuracy improvement across repetitions without any fine-tuning.

### 1.3 The skill-reinvention problem

Across sessions, agents re-implement the same utility functions (argument parsers, schema validators, retry wrappers). No mechanism exists to serialise a verified, working implementation, store it under a semantic embedding, and retrieve it for injection into a new task's context. Voyager (arxiv: 2305.16291) demonstrates a 3.3× improvement in unique items discovered and 15.3× faster milestone completion through this pattern in an open-ended environment; the mechanism transfers directly to software engineering tasks.

### 1.4 The ACI gap

Agentbox exposes raw Edit and Bash tools to coding agents. SWE-agent (arxiv: 2405.15793) shows that replacing a raw shell interface with an Agent-Computer Interface — a bounded file editor showing only changed lines plus context, an agent-tuned search with a line budget, and a compact diff view — lifts autonomous bug-fixing on SWE-bench from roughly 3% (non-interactive LM baseline) to 12.5% pass@1. The existing codebase-memory MCP provides structural graph queries (`trace_path`, `search_graph`) but does not provide the edit-and-test loop with agent-friendly affordances that the ACI pattern requires.

---

## 2. Principles

1. **Inference-only.** Agentbox is a containerised inference harness, not a training platform. No capability in this PRD requires RL fine-tuning, RLHF, or any gradient update. All learning is in-context or in-storage. Any paper whose key contribution is training-time supervision is out of scope by definition.

2. **MCP-everywhere.** Every new capability that exposes tools to the coordinator is an MCP server registered in `skills/mcp.json` and spawned on stdio. No bespoke HTTP service, no ad-hoc subprocess wrapper exposed as a pseudo-tool.

3. **Manifest-gated.** Every capability has an `agentbox.toml` toggle. Disabled features contribute no packages to the image, no supervisor blocks, and no MCP registrations. The toggle name for each capability is specified in §4.

4. **Audit trail non-optional when the feature is on.** Kernel executions, lesson writes, skill-library writes, and ACI operations each produce JSONL audit entries under `/var/lib/agentbox/code-harness/`. The audit path cannot be disabled independently of the feature.

5. **Per-session isolation by default.** IPython kernels are owned by the session that created them and die when the session ends. Kernel state does not cross session boundaries unless an explicit worktree-scoped mode is enabled (see §10, open questions). Multiple concurrent sessions get independent kernel processes.

6. **Trace-as-reward.** Execution observation is the primary verification signal: did the code run, did assertions pass, what were the runtime metrics? LLM-judge verdicts are a fallback for steps where execution cannot produce a signal, not the primary mechanism. This prevents lesson-hallucination and skill-library pollution.

7. **Skill library is verified-before-stored.** A code function reaches the Voyager skill library only when: (a) it executes without exception, (b) its inline assertions pass, and (c) `verification-quality` assigns a truth-score ≥ 0.95. Functions that pass steps (a) and (b) but not (c) are quarantined in a `skill-candidates` namespace and not injected into future tasks.

8. **Existing primitives reused before new ones.** The ExpeL lesson-extractor wraps existing `hooks post-task` and `mcp__ruvector__memory_store`. The tree-search skill wraps existing sparc:coder and build-with-quality. The ACI MCP wraps existing Edit, Bash, and codebase-memory tools. The kernel MCP is the only genuinely new service; everything else is an orchestration layer over existing capabilities.

9. **No collision with existing skills without an explicit routing rule.** The skills added here — codeact, expel, voyager-skills, tree-search-coder — overlap in surface with sparc:code, deepseek-reasoning, and pytorch-ml. The skill-router SKILL.md `### Code-as-Harness` section must specify exact decision criteria distinguishing each new skill from the skills it resembles. Ambiguous routing is a bug, not an acceptable state.

---

## 3. Wire contracts

### 3.1 Persistent code-interpreter MCP

**MCP name:** `code-interpreter`
**Transport:** stdio (spawned by Claude Code per session)
**Process:** Python, wrapping an IPython kernel via `ipykernel`
**Lifetime:** per-session; supervisor `autorestart = true` within session; process terminates with session

#### Tool table

Canonical tool set defined by ADR-018 §Wire contract.

| Tool | Input schema | Output schema | Notes |
|---|---|---|---|
| `kernel.exec` | `{"code": string, "timeout_s": integer = 30}` | `{"stdout": string, "stderr": string, "result": any\|null, "exception": object\|null, "duration_ms": integer, "cell_id": integer}` | Executes code in the persistent kernel namespace; `result` is the last expression value (repr); `exception` is null or `{type, message, traceback}` |
| `kernel.list_vars` | `{}` | `{"vars": [{"name": string, "type": string, "size_hint": string}]}` | Lists all names in the kernel namespace with type and, for ndarray/DataFrame, a shape hint; no serialisation of values |
| `kernel.inspect` | `{"name": string}` | `{"name": string, "type": string, "repr": string, "shape": any, "dtype": any, "len": any}` | Richer introspection for a single variable |
| `kernel.reset` | `{}` | `{"ok": bool}` | Restarts the kernel; clears all namespace state; does not kill the MCP server process |
| `kernel.interrupt` | `{}` | `{"ok": bool}` | Sends SIGINT to the running cell; safe to call mid-`kernel.exec` |
| `kernel.install_pkg` | `{"name": string}` | `{"ok": bool, "version": string\|null, "error": string\|null}` | Installs a package into the kernel's venv from the **local wheelhouse only** (network is off inside the kernel — see ADR-018 §Package install policy); gated by `[skills.code_interpreter].allow_pip_install = true` and an allow-list; `ok=false` if package is not on the allow-list or its wheel is absent |

#### Lifetime semantics

- Cold-start target: < 500 ms (IPython kernel spawn).
- Idle memory: < 100 MB RSS at idle (no loaded datasets).
- Idle timeout: configurable via `[skills.code_interpreter] idle_timeout_s = 1800`; kernel pauses (not killed) after this period and resumes on next tool call.
- Crash recovery: supervisor restarts the kernel process; `exec_count` resets to 0; coordinator is notified via a `{"ok": false, "error": "kernel_restarted"}` response on the next call.

#### Audit JSONL

Path: `/var/lib/agentbox/code-harness/kernel-<session-id>-<YYYY-MM-DD>.jsonl`

Record shape per execution:
```json
{"ts": "ISO8601", "session": "...", "tool": "kernel.exec", "exec_count": 42,
 "code_sha256": "...", "ok": true, "wall_ms": 123, "stdout_len": 400,
 "stderr_len": 0, "error": null}
```

### 3.2 SWE-agent ACI MCP

**MCP name:** `aci-shell`
**Transport:** stdio
**Process:** Node.js thin wrapper over Edit, Bash, and codebase-memory
**Lifetime:** per-session

#### Tool table

| Tool | Input schema | Output schema | Notes |
|---|---|---|---|
| `aci.view_file` | `{"path": string, "start_line": integer, "end_line": integer}` | `{"ok": bool, "content": string, "line_count": integer}` | Returns only the requested window; max 150 lines per call |
| `aci.edit_file` | `{"path": string, "start_line": integer, "end_line": integer, "replacement": string}` | `{"ok": bool, "diff": string, "lines_changed": integer}` | Bounded edit; returns compact diff with ±5 lines of context |
| `aci.search_repo` | `{"pattern": string, "file_glob": string = "**", "max_results": integer = 20}` | `{"ok": bool, "matches": [{"file": string, "line": integer, "text": string}]}` | Agent-tuned grep with hard line-budget; filters binary files |
| `aci.run_tests` | `{"cmd": string, "timeout_ms": integer = 60000}` | `{"ok": bool, "passed": integer, "failed": integer, "errors": integer, "output": string}` | Runs test command; parses structured output (pytest, jest, cargo test) |
| `aci.submit` | `{"message": string}` | `{"ok": bool}` | Signals task completion; triggers final audit record |

#### Lifetime semantics

Stateless per call; no kernel process. Audit JSONL under `/var/lib/agentbox/code-harness/aci-<session-id>-<YYYY-MM-DD>.jsonl`.

### 3.3 CodeAct skill (SKILL.md frontmatter proposal)

```yaml
name: codeact
description: >
  CodeAct agent loop. Translates all agent actions — tool calls, environment
  queries, state mutations — into executable Python running in the persistent
  code-interpreter MCP kernel. Enables multi-turn revision of prior actions
  upon new observations. Requires code-interpreter MCP to be enabled.
when_to_choose: >
  Multi-step tasks where intermediate state must persist across reasoning
  steps, where actions depend on prior execution results, or where the tool
  call overhead of JSON-format actions is measurable. NOT for single-file
  edits or quick fixes — use sparc:code or direct Edit for those.
depends_on_mcps: [code-interpreter]
```

### 3.4 ExpeL lesson-extractor skill (SKILL.md frontmatter proposal)

```yaml
name: expel
description: >
  Lesson-extractor agent. After any task completion (success or instructive
  failure), analyses the task trajectory and distils reusable natural-language
  lessons into the RuVector 'code-harness-lessons' namespace. Lessons are
  retrieved by semantic search at future task start to guide the agent.
  Wraps hooks post-task + mcp__ruvector__memory_store. No new infra.
when_to_choose: >
  Run automatically as part of hooks post-task when
  features.expel_lesson_extraction = true. Can also be invoked manually
  after a complex or failed task to explicitly extract lessons. Do NOT
  invoke for trivial one-liner tasks — threshold is tasks with ≥3 tool calls.
depends_on_mcps: []
```

### 3.5 Voyager verified skill library skill (SKILL.md frontmatter proposal)

```yaml
name: voyager-skills
description: >
  Verified skill library manager. Stores verified, assertion-passing Python
  functions in RuVector under the 'verified-skills' namespace with semantic
  embeddings. Retrieves relevant prior skills at task start for injection into
  context. Requires ExpeL lesson-extractor to be live for maximum signal
  quality. Uses verification-quality truth-score ≥ 0.95 as write gate.
when_to_choose: >
  Tasks that involve utility functions, parsers, validators, or algorithms
  likely to be reused across sessions. NOT for one-off scripts or
  project-specific domain logic unlikely to transfer.
depends_on_mcps: []
```

### 3.6 Execution-gated tree-search skill (SKILL.md frontmatter proposal)

```yaml
name: tree-search-coder
description: >
  Execution-gated tree-search orchestrator. Generates N candidate programs
  (default N=3), executes each via the code-interpreter MCP, scores by
  execution metrics (pass rate, wall time, assertion coverage), selects the
  best branch, and optionally continues search from that branch. Implements
  the ORPS and Tree-of-Code search patterns. Slow path — opt-in only.
when_to_choose: >
  Correctness-critical code generation where a single attempt is insufficient,
  or where multiple algorithmic approaches should be explored and benchmarked
  before committing. NOT for exploratory or best-effort code.
depends_on_mcps: [code-interpreter]
```

---

## 4. Surfaces

| # | Name | Type | ADR pointer | Manifest toggle | Build cost | Classification | Expected lift |
|---|---|---|---|---|---|---|---|
| 1 | Persistent code-interpreter MCP | MCP | ADR-018 | `[skills.code_interpreter] enabled = true` | M | build-now | Large (+12% to +27% on code benchmarks) |
| 2 | CodeAct skill | Skill | ADR-018 | `[skills.codeact] enabled = true` | M | build-now (after #1) | Large (+20% success rate on tool-use benchmarks) |
| 3 | ExpeL lesson-extractor | Skill | ADR-019 | `[features.expel_lesson_extraction] enabled = true` | S | build-now | Medium (monotonic accuracy improvement across repetitions) |
| 4 | Voyager verified skill library | Skill | ADR-019 | `[skills.voyager_skill_library] enabled = true` | M | build-next | Large (3.3× unique item discovery, 15.3× milestone speed in reference paper) |
| 5 | SWE-agent ACI MCP | MCP | ADR-020 (stub) | `[skills.aci_shell] enabled = true` | M | build-next | Medium (~4× lift on repo-level bug-fixing vs non-interactive baseline) |
| 6 | Execution-gated tree-search skill | Skill | ADR-020 (stub) | `[skills.tree_search_coder] enabled = false` | M | build-next | Large (+26.9% correctness, +42.2% code efficiency) |

---

## 5. Out of scope / explicitly rejected

The following items were evaluated in the literature survey and rejected. They are not deferred for reconsideration — they are closed decisions unless a new ADR reverses them.

- **OpenHands sandboxed OS runtime (paper-T2-openhands):** L-cost infrastructure rewrite; agentbox already has browsercontainer for sandboxed execution; full OS sandbox is a platform pivot, not a skill addition.
- **NExT execution-trace Chain-of-Thought (paper-T1-next):** Requires training-time self-supervised rationale generation — not an inference-time pattern; L build cost with no deployable path in an inference harness.
- **MIRIX multi-tier memory schema extension (paper-T4-mirix):** Requires RuVector schema extension for multimodal and procedural tiers — L infrastructure cost; procedural memory is partially addressed by the Voyager skill library at M cost.
- **ToolNet adaptive skill routing (paper-T4-toolnet):** skill-router is static by design for predictability; adaptive edge-weight learning from telemetry adds operational complexity without a clear accuracy benchmark for agentbox's 89-skill catalogue.
- **SWE-Debate adversarial topology (paper-T4-swedebate):** M cost for a topology that is strictly a variant of existing hive-mind-advanced Byzantine consensus; lift is measurable only on SWE-bench resolution tasks, not general use.
- **All RL training papers (RLTF, RLEF, CWM, agent-world-model, code2world, rl-world-model):** Training-time RL infrastructure is outside agentbox scope as a containerised inference harness.
- **RoboCodeX (paper-T2-robocodex):** Embodied robotics control surface does not exist in agentbox.
- **CodexGraph (paper-T4-codexgraph):** Already covered by codebase-memory MCP (`trace_path`, `search_graph`, `get_code_snippet` are identical primitives).
- **MemGPT (paper-T4-memgpt):** Already covered by agentdb-memory-manager and RuVector HNSW tiered storage.
- **RepoCoder (paper-T4-repocodr):** Already covered — codebase-memory graph retrieval is strictly richer than similarity-only iterative retrieval.
- **ReAct (paper-T2-react):** Already implicit in sparc:orchestrator and hive-mind consensus loop; no incremental skill value.
- **PoE-World compositional environment modeller (paper-T3-poe-world):** Reclassified from 'defer' (in convergence-shortlist) to 'explicitly rejected' because PoE-World's compositional-environment-modelling pattern has no observed use case in the current agentbox skill mix; reopen if a planning-time environment forecast use case emerges.
- **Tree-of-Code as a separate surface (paper-T4-tree-of-code):** Not a distinct rejection — the Tree-of-Code search pattern is fully absorbed into the `tree-search-coder` skill defined in ADR-020 alongside ORPS. Listed here only to make explicit that no separate Tree-of-Code skill or MCP will be built; the convergence shortlist did not flag it for separate treatment.

---

## 6. Phasing and rollout

### Phase 1 — build-now (parallel tracks, target: current sprint)

Items 1, 3, and 5 from §4 can be built in parallel because they share no runtime dependencies.

| Track | Item | Acceptance gate |
|---|---|---|
| Track A | Persistent code-interpreter MCP (ADR-018) | See §7 kernel criteria |
| Track B | ExpeL lesson-extractor skill (ADR-019) | See §7 ExpeL criteria |
| Track C | SWE-agent ACI MCP (ADR-020 stub) | See §7 ACI criteria |

Phase 1 acceptance: all three tracks green before Phase 2 begins.

### Phase 2 — build-next (sequential, after Phase 1 green)

Item 2 (CodeAct) depends on Track A. Item 4 (Voyager) depends on Tracks A and B. Item 6 (tree-search) depends on Track A. Phase 2 can partially parallelise once Track A is green.

| Order | Item | Dependency |
|---|---|---|
| 2a | CodeAct skill | Track A (kernel MCP) |
| 2b | Voyager verified skill library | Track A + Track B (ExpeL) |
| 2c | Execution-gated tree-search skill | Track A (kernel MCP) |

### Phase 3 — deferred

PoE-World compositional environment modeller: revisit if game-dev skill adoption creates demand. Multi-tier memory (MIRIX pattern): revisit if RuVector schema work is separately funded.

---

## 7. Acceptance criteria

Acceptance criteria are measurable and binary unless stated otherwise.

### Kernel MCP (Track A)

1. `tools/list` via MCP protocol returns exactly 6 tools matching ADR-018 §Wire contract (`kernel.exec`, `kernel.list_vars`, `kernel.inspect`, `kernel.reset`, `kernel.interrupt`, `kernel.install_pkg`).
2. Sequential stateful execution: `kernel.exec("x = 1")` followed by `kernel.exec("print(x)")` returns `stdout: "1\n"` — variable persists across calls.
3. Cold-start latency < 500 ms from process spawn to first `kernel.exec` response.
4. Idle RSS < 100 MB measured 60 seconds after last `kernel.exec` with no loaded datasets.
5. Supervisor auto-restarts the kernel process within 5 s of SIGKILL.
6. After restart, the next `kernel.exec` returns `{"ok": false, "error": "kernel_restarted", ...}` rather than hanging.
7. Audit JSONL is written within 50 ms of each execution completing.
8. `kernel.reset` clears the namespace: `kernel.exec("x = 1"); kernel.reset(); kernel.exec("print(x)")` returns an execution error (`NameError`), not "1".
9. Manifest toggle `[skills.code_interpreter] enabled = false` results in no MCP registration in `skills/mcp.json` and no supervisor block generated.

### CodeAct skill (Phase 2a)

1. GSM8K subset (50 problems, randomly sampled): accuracy ≥ 85% in CodeAct mode (write-exec-observe-revise loop) vs ≥ 73% Chain-of-Thought baseline. Measurement: automated harness, 3 runs, median reported.
2. A three-step task — (1) `kernel.exec("vals = list(range(20))")`; (2) `kernel.exec("acc = []\nfor v in vals: acc.append(v*v)")`; (3) `kernel.exec("print(','.join(str(x) for x in acc))")` — returns stdout exactly `"0,1,4,9,16,25,36,49,64,81,100,121,144,169,196,225,256,289,324,361"`. Measurement: automated harness `tests/code-harness/multi-turn-fibonacci.sh`. Pass: byte-for-byte stdout match.
3. `when_to_choose` criteria in skill-router SKILL.md correctly routes "multi-step stateful computation" to `codeact` and not to `sparc:code` or `pytorch-ml` — validated by skill-router classification on 10 representative prompts committed to `tests/fixtures/skill-router-prompts.json` (10 prompts, evenly split between codeact-appropriate and sparc-appropriate), threshold ≥ 8/10 correct route.

### ExpeL lesson-extractor (Track B)

1. After 10 task completions (mix of successes and failures) with `features.expel_lesson_extraction = true`, `mcp__ruvector__memory_search({query: "lesson", namespace: "code-harness-lessons"})` returns ≥ 1 entry.
2. Every stored lesson record contains: `task_id`, `trajectory_summary`, `lesson_text`, `source` = `"execution-grounded"` (not `"free-reflection"`).
3. For each of 5 held-out queries (committed in `tests/code-harness/lesson-retrieval-queries.json`), the corresponding seeded lesson appears in the top-3 results returned by `memory_search` with `namespace=code-harness-lessons`, `limit=5`. Pass: 5/5 queries hit top-3.
4. No lesson is stored for tasks with < 3 tool calls (trivial-task filter active).
5. The feature can be disabled at runtime by setting `features.expel_lesson_extraction = false` without restarting supervised services.

### Voyager verified skill library (Phase 2b)

1. Skill library survives session restart: functions written in session A are retrievable by `mcp__ruvector__memory_search` in session B.
2. After a benchmark run (10 tasks with reusable utility functions), verified-skills count > 0 in the `verified-skills` namespace.
3. A function that fails its inline assertions is not written to `verified-skills` (quarantine path to `skill-candidates` is used instead).
4. At task start, the skill-router prompt injects up to 3 retrieved verified skills when relevant (cosine similarity ≥ 0.70 to task description).
5. Skill injection does not exceed 2 000 tokens of context overhead per task.

### SWE-agent ACI MCP (Track C)

1. `tools/list` returns 5 tools (`aci.view_file`, `aci.edit_file`, `aci.search_repo`, `aci.run_tests`, `aci.submit`).
2. SWE-bench-Lite subset (5 problems, manually selected for scope fit): pass-rate ≥ 30% (≥ 2/5 resolved) when run with the ACI MCP active vs the raw Bash/Edit baseline. Measurement: single run, manual verification.
3. `aci.view_file` never returns more than 150 lines per call (hard budget enforced server-side).
4. `aci.edit_file` returns a compact diff with ≤ 10 lines of unchanged context above and below the edit.
5. `aci.search_repo` returns at most `max_results` matches and explicitly truncates with a count of omitted results.

### Execution-gated tree-search skill (Phase 2c)

1. Given a correctness-critical function (e.g. a JSON schema validator), tree-search with N=3 candidates selects the candidate with the highest assertion pass rate, not necessarily the first generated.
2. End-to-end wall time for N=3 on a simple function (< 30 LOC) < 120 s including kernel exec overhead.
3. The skill is off by default (`[skills.tree_search_coder] enabled = false`); it must be explicitly enabled; skill-router does not route to it without an explicit `[tree-search]` directive or explicit user request.

---

## 8. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Kernel memory leak across long sessions | Medium | High (OOM kills session) | Supervisor `memcap` cgroup limit (default 512 MB per kernel process); RSS polled every 30 s via `agentbox_kernel_mem_rss_mb` metric; operator alert at 400 MB |
| Pip install in kernel introduces malicious package | Low | Critical | `kernel.install_pkg` is disabled by default (`[skills.code_interpreter] allow_pip_install = false`); when enabled, only an operator-specified allowlist of packages is permitted; kernel has `JUPYTER_NO_NETWORK=1` set at spawn; `kernel.install_pkg` reads from a pre-built venv only; no public-mirror access in v1. If public-mirror egress is needed in future, gate behind `[skills.code_interpreter].allow_public_mirror = false` (new manifest key, opt-in) |
| Skill-router collision with sparc:code, deepseek-reasoning, pytorch-ml | High | Medium | Mandatory `### Code-as-Harness` section in skill-router SKILL.md specifying exact decision criteria; validated by classification test in Phase 2a acceptance criteria |
| Voyager skill library pollution from buggy verifications | Medium | Medium | Three-gate write: (a) execution without exception, (b) inline assertion pass, (c) `verification-quality` truth-score ≥ 0.95; quarantine namespace for near-misses; library can be wiped and rebuilt from task history |
| ExpeL lesson hallucination (free-form LLM reflection stored as fact) | Medium | Medium | Lessons must cite a specific execution observation (stdout, stderr, assertion result, or test outcome) as their grounding; the distillation prompt requires a `source_evidence` field; lessons without grounding evidence are discarded, not stored |
| ACI MCP confused with codebase-memory MCP by skill-router | Medium | Low | Explicit "when to choose" table distinguishing: codebase-memory is for read-only structural graph queries; ACI is for the write-exec-test loop in autonomous bug-fixing tasks |
| Tree-search cost overrun (N too high, tasks too expensive) | Medium | Medium | N is capped at 5 in the skill manifest; per-branch timeout enforced by `kernel.exec timeout_ms`; the skill logs total spend per invocation; operator can lower N via manifest |
| Session isolation violation (kernel A reads kernel B state) | Low | Critical | Each session spawns an independent kernel process; no shared memory segment; process UIDs are all `devuser` but filesystem isolation via per-session temp dirs; no inter-kernel IPC |

---

## 9. Observability

ADR-005 middleware applies unconditionally when any code-harness feature is enabled. All three middleware layers — observability, privacy filter (ADR-008), and JSON-LD encoder (ADR-012) — wrap each MCP dispatch in the standard order.

### Prometheus metrics

| Metric | Type | Labels | Description |
|---|---|---|---|
| `code_harness_kernel_exec_total` | Counter | `session`, `outcome` | Total `kernel.exec` calls; `outcome` ∈ {ok, error, timeout, kernel_restarted} |
| `code_harness_kernel_exec_duration_ms` | Histogram | `session` | Wall time per execution |
| `code_harness_kernel_mem_rss_mb` | Gauge | `session` | Kernel RSS polled every 30 s |
| `code_harness_lessons_stored_total` | Counter | — | ExpeL lessons written to RuVector |
| `code_harness_skills_stored_total` | Counter | `gate` | Voyager skills written; `gate` ∈ {verified, quarantined} |
| `code_harness_aci_calls_total` | Counter | `tool`, `outcome` | ACI MCP calls by tool name |
| `code_harness_tree_search_branches_total` | Counter | `n` | Tree-search branches explored per invocation |

### Spans

Format: `agentbox.mcp.<component>.<operation>` using dots for hierarchy and snake_case within each segment (matching ADR-011 precedent and the `[skills.code_interpreter]` TOML key). Examples: `agentbox.mcp.code_interpreter.exec`, `agentbox.mcp.code_interpreter.list_vars`, `agentbox.mcp.code_interpreter.inspect`, `agentbox.mcp.code_interpreter.reset`, `agentbox.mcp.code_interpreter.interrupt`, `agentbox.mcp.code_interpreter.install_pkg`, `agentbox.mcp.aci_shell.edit_file`. Attached to the OTLP pipeline at `[observability].otlp_endpoint`. Trace context propagates from the coordinator through each MCP call.

### Audit JSONL

All audit files under `/var/lib/agentbox/code-harness/`. Files rotate daily. Retention policy follows the global `[observability].audit_retention_days` setting (default 30).

| File pattern | Written by |
|---|---|
| `kernel-<session>-<date>.jsonl` | Persistent code-interpreter MCP |
| `aci-<session>-<date>.jsonl` | SWE-agent ACI MCP |
| `lessons-<date>.jsonl` | ExpeL lesson-extractor |
| `skills-<date>.jsonl` | Voyager skill library (writes and quarantines) |
| `tree-search-<session>-<date>.jsonl` | Execution-gated tree-search skill |

---

## 10. Open questions

These questions are unresolved as of Draft v1. Each will be answered by the ADR that implements the relevant item.

1. **Kernel scope: per-session vs per-worktree.** The current specification is per-session. When agents operate in worktree isolation (ruflo swarms with `isolation: "worktree"`), should the kernel scope follow the worktree boundary rather than the session? Shared worktree kernels would allow swarm agents to share state; isolated kernels are safer but lose the collaboration benefit. ADR-018 must decide.

2. **Pip install policy.** The kernel `allow_pip_install` flag is off by default. The policy for what can be on the operator allowlist is not yet specified. Options: (a) explicit per-package allowlist in `agentbox.toml`, (b) a signed package allowlist distributed with the image, (c) no pip install ever (rely on Nix packages only). Nix-only is cleanest but blocks rapid prototyping. ADR-018 must decide.

3. **GPU access from the kernel.** The browsercontainer has GPU access for WebGL/WebGPU. Should the code-interpreter kernel also have GPU access (for PyTorch/CUDA workloads)? If yes, the kernel process needs the NVIDIA runtime and a cgroup GPU device allowlist. This significantly expands the attack surface. ADR-018 must decide.

4. **State persistence across sessions.** The current specification kills the kernel on session end. For long-running workflows (multi-day feature builds), users may want kernel namespaces to survive session boundaries. This would require serialising the kernel state (dill/pickle) to a session-scoped file at shutdown and restoring it on next session start. Security implications (deserialisation of arbitrary pickles) are non-trivial. ADR-018 must decide.

5. **Lesson quality threshold.** The ExpeL lesson-extractor requires a `source_evidence` field but does not yet specify a minimum evidence quality bar (e.g. must the evidence be a test pass? a specific assertion? any non-empty stdout?). A too-permissive threshold produces noise; a too-strict threshold produces silence. ADR-019 should specify the threshold with a calibration task.

6. **Voyager skill discovery surface.** Where are verified skills surfaced to the operator? Options: (a) injected silently into each task context by the skill (current plan), (b) listed via a `voyager-skills list` command in the skill-router, (c) visible in a management-api endpoint. All three may be needed. ADR-019 must decide which ships in Phase 2b.

7. **ACI vs codebase-memory delineation in practice.** The design intention is clear (read-only graph queries vs write-exec-test loop), but in practice an agent doing autonomous bug fixing will want both. The interaction pattern (use codebase-memory to navigate, switch to ACI to edit and test) needs to be documented in a routing example in the skill-router SKILL.md before Phase 2 ships.

---

## 11. References

Papers are cited by arxiv ID. Papers with a 2025 publication year and arxiv submission date after 2026-05-20 are marked [preprint/forthcoming] — their results are treated as provisional until formally published.

| ID | Title | arxiv | Year | Tier | Role in this PRD |
|---|---|---|---|---|---|
| PoT | Program of Thoughts Prompting | 2211.12588 | 2023 | T1 | Evidence for kernel MCP lift (§1.1, §7 CodeAct criteria) |
| CoC | Chain of Code | 2312.04474 | 2024 | T1 | Evidence for kernel MCP lift via LM-emulator pattern (§1.1, §3.1); LMulator tool deferred to v2 per ADR-018 §Consequences |
| CodeAct | Executable Code Actions Elicit Better LLM Agents | 2402.01030 | 2024 | T2 | Foundation for CodeAct skill (§1.1, §3.3, §7) |
| Voyager | Voyager: An Open-Ended Embodied Agent | 2305.16291 | 2023 | T2 | Foundation for Voyager skill library (§1.3, §3.5, §7) |
| SWE-agent | SWE-agent: Agent-Computer Interfaces | 2405.15793 | 2024 | T2 | Foundation for ACI MCP (§1.4, §3.2, §7) |
| ExpeL | ExpeL: LLM Agents Are Experiential Learners | 2308.10144 | 2023 | T4 | Foundation for ExpeL lesson-extractor (§1.2, §3.4, §7) |
| ORPS | Reasoning Through Execution | 2412.15118 | 2025 | T1 | Evidence for tree-search lift (§1.1, §3.6, §7) [preprint/forthcoming] |
| Tree-of-Code | Tree-of-Code: A Tree-Structured Exploring Framework | 2412.15305 | 2024 | T4 | Evidence for tree-search pattern (§3.6, §7) [preprint/forthcoming] |

### Internal cross-references

- [ADR-018 — Persistent code-interpreter MCP and CodeAct skill](../adr/ADR-018-persistent-code-interpreter-mcp.md)
- [ADR-019 — Experiential skill learning: ExpeL and Voyager patterns](../adr/ADR-019-experiential-skill-learning.md)
- [ADR-020 — SWE-agent ACI MCP and tree-search orchestration (stub)](../adr/ADR-020-aci-mcp-tree-search.md)
- [DDD-005 — Code-execution and experiential-learning domain](../ddd/DDD-005-code-execution-domain.md)
- [PRD-001 — Capabilities and adapters](PRD-001-capabilities-and-adapters.md)
- [ADR-005 — Pluggable adapter architecture](../adr/ADR-005-pluggable-adapter-architecture.md)
- [ADR-015 — MCP RuVector mandate](../adr/ADR-015-mcp-ruvector-mandate.md)
- [`skills/SKILL-DIRECTORY.md`](../../../skills/SKILL-DIRECTORY.md) — skill routing and decision tree
- [`verification-quality` skill](../../../skills/verification-quality/) — truth-score gate used by Voyager write path
