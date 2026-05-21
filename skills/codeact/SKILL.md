---
name: codeact
description: >
  Plan-execute-reflect loop over a persistent Python kernel (the
  `code-interpreter` MCP). Write Python -> execute -> observe stdout/exception/
  last value -> revise. Variables, imports, and dataframes survive across
  every tool call in the session. Use for numerical reasoning, data
  wrangling, scientific Q&A, multi-step calculations, hypothesis-test loops,
  anything where intermediate state must persist between turns. +12pp on
  Chain-of-Code BBH, +20% on CodeAct tool-use benchmarks vs CoT baseline,
  10-81% more token-efficient than dedicated reasoning models.
version: 0.1.0
triggers:
  - /codeact
  - write code and run
  - persistent python
  - multi-turn computation
  - data wrangling with state
depends_on_mcps:
  - code-interpreter
related_skills:
  - sparc-code  # SPARC: orchestrator-shaped, plans then writes; CodeAct executes interactively
  - deepseek-reasoning  # math-heavy reasoning without execution
  - pytorch-ml  # heavy GPU scripts (no shared state)
  - build-with-quality  # full TDD swarm -- when assertions + tests matter more than exploration
---

# CodeAct Skill

Interactive, stateful Python execution loop using the `code-interpreter` MCP.
All agent actions are expressed as executable Python. The kernel persists for
the duration of the session; every variable, import, and computed value is
available in subsequent tool calls.

---

## Use

Choose this skill when:

- A task requires multiple sequential computation steps that depend on each
  other's results (e.g. load data, filter, aggregate, visualise).
- Intermediate state (DataFrames, model objects, parsed structures) would be
  expensive or awkward to re-derive from scratch on every tool call.
- The agent needs to observe a runtime result -- an exception traceback, a
  printed value, an assertion outcome -- and revise its approach based on that
  observation. This write-exec-observe-revise loop is the CodeAct Loop.
- Tasks span numerical reasoning, data wrangling, hypothesis testing, or any
  scientific computation where the Python interpreter is the source of truth.

---

## Don't Use When

- **Single-file code generation without execution** -- use `sparc-code`. That
  skill orchestrates plan-then-write; no kernel needed, no cold-start cost.
- **Pure mathematical reasoning without code execution** -- use
  `deepseek-reasoning`. When the chain of thought is symbolic and no data needs
  loading, a reasoning model is cheaper and faster.
- **Heavy GPU training or multi-file ML scripts** -- use `pytorch-ml`. That
  skill manages script files, sweeps, and checkpoints in stateless subprocess
  mode. The kernel MCP is CPU-only in v1 and is not designed for long-running
  training loops.
- **Full TDD pipeline with assertion gates, coverage reporting, and defect
  prediction** -- use `build-with-quality`. That skill coordinates 111+ agents
  with quality gates. CodeAct is an exploration tool, not a QE pipeline.

---

## How It Works

This skill is a routing and in-context-learning primer. It carries no Python
itself. When invoked, it primes the model with the CodeAct Loop protocol and
hands off all execution to the `code-interpreter` MCP via `kernel.exec`.

The loop protocol the model follows:

1. **Write** a small, focused Python block addressing the current sub-goal.
2. **Call** `kernel.exec` with that block.
3. **Read** the returned `ExecutionTrace`: inspect `stdout`, `result`, and
   `exception`. The `ExecutionTrace` is the canonical evidence record; LLM
   opinion about what the code does is not.
4. If `exception` is non-null or `stdout` does not match the expected output,
   **revise** the block and call `kernel.exec` again. If the output is correct,
   advance to the next sub-goal.
5. All variables from prior `exec` calls remain in the `KernelSession`
   namespace. Reference them freely without re-importing or recomputing.

The model continues this loop until the task is complete or until a
`kernel.reset` is required to clear corrupted namespace state.

The `code-interpreter` MCP exposes six tools on the `KernelSession`:
`kernel.exec`, `kernel.list_vars`, `kernel.inspect`, `kernel.reset`,
`kernel.interrupt`, and `kernel.install_pkg`. The CodeAct Loop primarily uses
`kernel.exec`; the remaining tools support debugging and introspection.

Execution verification follows the Trace-as-Reward principle (DDD-005): the
`ExecutionTrace` is the ground truth. If the trace shows a clean exit with the
expected `stdout` or `result`, the step is verified. No LLM judge is in the
critical path.

---

## In-Context Learning Exemplars

The three exemplars below show the exact tool call syntax the model emits.
Each exemplar references variables from the prior call to demonstrate
`KernelSession` state persistence.

---

### Exemplar 1 -- Numerical Reasoning with Intermediate DataFrame

**Task**: Given a CSV at `/tmp/sales.csv`, find rows where `revenue` exceeds
the mean of `cost`, sorted by `margin` descending, top 5.

**Call 1 -- load and inspect**

```
Tool: code-interpreter.kernel.exec
Args: {
  "code": "import pandas as pd\ndf = pd.read_csv('/tmp/sales.csv')\nprint(df.shape)\nprint(df.dtypes)"
}
Trace: {
  "stdout": "(4821, 6)\nregion       object\nproduct      object\nrevenue     float64\ncost        float64\nmargin      float64\nquarter      object\ndtype: object\n",
  "result": null,
  "exception": null,
  "duration_ms": 231
}
```

State after call 1: `df` is live in the `KernelSession`. No re-read needed.

**Call 2 -- filter using `df` from call 1**

```
Tool: code-interpreter.kernel.exec
Args: {
  "code": "cost_mean = df['cost'].mean()\nfiltered = df[df['revenue'] > cost_mean].copy()\nprint(f'cost_mean={cost_mean:.2f}, rows matching={len(filtered)}')"
}
Trace: {
  "stdout": "cost_mean=18432.71, rows matching=2194\n",
  "result": null,
  "exception": null,
  "duration_ms": 18
}
```

State after call 2: `filtered` and `cost_mean` persist. The filter was
derived from the loaded data without reloading.

**Call 3 -- sort and head using `filtered` from call 2**

```
Tool: code-interpreter.kernel.exec
Args: {
  "code": "top5 = filtered.sort_values('margin', ascending=False).head(5)\nprint(top5[['product', 'revenue', 'cost', 'margin']].to_string(index=False))"
}
Trace: {
  "stdout": "     product   revenue     cost   margin\n  Widget-Pro  98432.00  12100.00  86332.0\n  Widget-Pro  94100.50  11900.00  82200.5\n  Service-A   88250.00  10200.00  78050.0\n  Widget-X    75300.00   9800.00  65500.0\n  Service-B   70100.00   9200.00  60900.0\n",
  "result": null,
  "exception": null,
  "duration_ms": 9
}
```

The result is the top-5 rows. Task complete. Variables `df`, `filtered`,
`cost_mean`, and `top5` remain available for follow-up queries without
reloading the CSV.

---

### Exemplar 2 -- Iterative Regex / Parsing on Real Text

**Task**: Extract every ISO-8601 date from `/var/log/app.log` and produce a
histogram by month.

**Call 1 -- extract dates**

```
Tool: code-interpreter.kernel.exec
Args: {
  "code": "import re\nfrom collections import Counter\n\nwith open('/var/log/app.log') as fh:\n    text = fh.read()\n\npattern = r'\\b(\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01]))\\b'\ndates = re.findall(pattern, text)\nprint(f'found {len(dates)} date occurrences')\nprint('sample:', dates[:5])"
}
Trace: {
  "stdout": "found 1847 date occurrences\nsample: ['2026-01-03', '2026-01-03', '2026-01-07', '2026-02-11', '2026-02-11']\n",
  "result": null,
  "exception": null,
  "duration_ms": 84
}
```

State after call 1: `dates` list is live. No re-read of the log file needed.

**Call 2 -- histogram by month using `dates` from call 1**

```
Tool: code-interpreter.kernel.exec
Args: {
  "code": "months = Counter(d[:7] for d in dates)\nfor month, count in sorted(months.items()):\n    bar = '#' * (count // 10)\n    print(f'{month}  {count:4d}  {bar}')"
}
Trace: {
  "stdout": "2026-01   412  ########################################\n2026-02   389  ######################################\n2026-03   401  ########################################\n2026-04   317  ###############################\n2026-05   328  ################################\n",
  "result": null,
  "exception": null,
  "duration_ms": 4
}
```

The histogram is complete in two `exec` calls. The `dates` list produced in
call 1 was reused directly; the file was read exactly once.

---

### Exemplar 3 -- Hypothesis-Test Loop with Explicit Assertion and Revision

**Task**: Compute 17^23 mod 100.

**Call 1 -- first attempt (simulating a naive mistake)**

```
Tool: code-interpreter.kernel.exec
Args: {
  "code": "result = 17 ** 23 % 100\nprint(result)"
}
Trace: {
  "stdout": "57\n",
  "result": null,
  "exception": null,
  "duration_ms": 2
}
```

The model observes `stdout: "57\n"`. Suppose the model had expected a
different answer from mental arithmetic. It adds an assertion to validate
using a cross-check:

**Call 2 -- assertion and independent verification**

```
Tool: code-interpreter.kernel.exec
Args: {
  "code": "# Cross-check via pow() three-argument form (modular exponentiation)\ncross = pow(17, 23, 100)\nprint(f'pow() result: {cross}')\nassert result == cross, f'mismatch: {result} vs {cross}'\nprint('assertion passed')"
}
Trace: {
  "stdout": "pow() result: 57\nassertion passed\n",
  "result": null,
  "exception": null,
  "duration_ms": 2
}
```

Both methods agree: 17^23 mod 100 = 57. The `ExecutionTrace` carries
`exception: null` and the assertion-pass string in `stdout` -- this is
Trace-as-Reward in action. No LLM judge; the kernel is the verifier.

The variable `result` and `cross` remain in the `KernelSession` and can be
used in subsequent reasoning steps without recomputation.

---

## When to Choose vs Neighbouring Skills

| Need | Use | Why |
|---|---|---|
| One-shot execution, no state needed | Bash | No kernel overhead; exits cleanly |
| Multi-step code generation, no execution | `sparc-code` | Orchestrator, not executor; stateless |
| Multi-step WITH state across turns | **codeact** | Persistent `KernelSession`; Trace-as-Reward |
| Heavy GPU training or sweep | `pytorch-ml` | Subprocess-mode; kernel is CPU-only in v1 |
| TDD + assertion-driven QE pipeline | `build-with-quality` | Full 111-agent QE swarm |
| Math / symbolic reasoning without execution | `deepseek-reasoning` | Pure reasoning; no cold-start cost |
| Data analysis, single known dataset | **codeact** | State persists; revise without reload |

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

## Cost and Empirical Priors

Empirical measurements from the peer-reviewed literature that inform when
to prefer this skill over chain-of-thought or alternative skills:

- **+12pp on BIG-Bench Hard** (Chain of Code, arxiv:2312.04474): 84% vs 72%
  chain-of-thought baseline. The gain comes from real interpreter execution for
  arithmetic steps and LM-emulator fallback for semantic steps.
- **+20% success rate** on API-Bank tool-use benchmark (CodeAct,
  arxiv:2402.01030): measured across 17 LLMs; the unified executable action
  space consistently outperforms JSON/text action formats.
- **10-81% more token-efficient** than dedicated reasoning models (CodeAdapt,
  arxiv:2510.20909): the range reflects task type; numerical and data tasks
  show the largest efficiency gains.
- **+12pp over chain-of-thought on 8 benchmarks** (Program of Thoughts,
  arxiv:2211.12588): code-delegated arithmetic outperforms text-only reasoning
  for structured numerical problems.

These are inference-time patterns. No fine-tuning is required; all lifts are
achievable with a standard frontier model and the kernel MCP alone.

Operational cost note: idle kernel RSS is approximately 80 MB. With scientific
packages imported (pandas, numpy, scipy) this rises to 300-500 MB. Account for
this in swarm configurations where multiple agents run concurrently. The
`max_memory_mb` manifest key sets the advisory RLIMIT_AS ceiling (default
512 MB per kernel process); the operator alert fires at 400 MB RSS.

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

---

## References

- ADR-018: Persistent code-interpreter MCP and CodeAct skill
  (`docs/reference/adr/ADR-018-persistent-code-interpreter-mcp.md`)
- DDD-005: Code Execution and Experiential Learning Domain
  (`docs/reference/ddd/DDD-005-code-execution-domain.md`)
- PRD-008 §3.3 and §7 Phase 2a acceptance criteria
  (`docs/reference/prd/PRD-008-code-as-harness-integration.md`)
- arxiv:2402.01030 -- CodeAct: Executable Code Actions Elicit Better LLM Agents
- arxiv:2312.04474 -- Chain of Code: Reasoning with Language Model Executed Code
- arxiv:2211.12588 -- Program of Thoughts Prompting
- arxiv:2510.20909 -- CodeAdapt: token-efficiency benchmarks
