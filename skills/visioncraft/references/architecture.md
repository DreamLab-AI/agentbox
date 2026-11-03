# Portable method and execution boundaries

VisionCraft has three distinct surfaces: this skill's engineering guidance,
the versioned library/CLI contracts, and host integrations. Guidance can name
useful checks that a project has not installed; an executable claim requires
the corresponding installed tool, configuration and retained result.

## Ownership

| Component | Owns | Does not establish |
|---|---|---|
| Skill | Task selection, evidence discipline, debugging and design methods | That any tool or worker ran |
| Quality plan | Declared checks, subject, expectations and policy | That the selected checks cover every relevant behaviour |
| Explicit runner | Bounded declared executions and retained output/receipts | A sandbox or proof that a scanner opened all intended inputs |
| Gate evaluator | Deterministic aggregation under a declared policy | Semantic correctness or human acceptance |
| Sealmap | Finding dispositions, delivery attestations and family declarations; CLI artefact checks | Independent verification of self-reported observations |
| Host/CI | Tool availability, credentials, network/spend policy, scheduling and deployments | Automatic satisfaction of required evidence |

Use the package documentation for the actual released API. Do not treat a
Markdown template as runtime configuration or an API proposal as shipped code.
Historical `config/skill.yaml` had no discovered loader; it is retired as
an executable interface. This skill does not restore its ML, consensus or
orchestration claims.

## Process and evidence

Validation and reporting must not execute commands found in imported receipts.
Execution is explicit and scoped. An argv-based runner avoids implicit shell
expansion, but commands still have the caller's authority unless a separate
sandbox is actually applied. Bound duration and capture, retain incomplete
output on error, and stop/reap the whole owned process group on cancellation.

Use fresh private output locations, exact input snapshots and real completion
signals. Record intended and observed scope separately. Concurrent source edits,
missing bytes, stale exports and capture failures cannot silently become a
successful current receipt. Managed-output path checks reduce accidental
redirection; they are not a general sandbox against hostile concurrent mutation.

## Optional knowledge services

[Agentic QE](agentic-qe.md) is an optional external testing engine. Its direct
MCP tools can generate candidate tests, analyse coverage or report quality
evidence. VisionCraft does not implement a second AQE executor or copy its
agents. Discover the host's actual tools and preserve their raw results; run
generated tests with the project's real toolchain before treating them as
evidence. Ruflo coordination and direct AQE execution are separate observations.

A project may retain episodic attempts and durable lessons, use exact tags for
lookup, link entities/decisions, or combine lexical and semantic retrieval.
Those are useful host capabilities when implemented. Do not assume a vector
database, task DAG, memory-orientation endpoint, learning loop or background
consolidator exists because a reference describes one.

Use the approved interface and schema; retain exact sources and scope with
reusable lessons. Absence of a knowledge service does not prevent ordinary
development. Do not introduce another findings store or install an engine as a
side effect of invoking this skill. Any prediction/retrieval improvement needs
its own dataset, baseline, metric and measured result.

## Policy and degraded capability

Project/session policy controls applicable checks, tools, review independence,
cost and external effects. A simpler environment can still use expectations,
local tests and source review. Missing required capability is reported as
unavailable/incomplete; it is not silently replaced by a weaker check with the
same green label. Optional capability can be omitted with its scope stated.

The [Agentbox reference](ecosystem-agentbox.md) gives one concrete adapter case.
Other hosts can use their own CI, model providers, knowledge tools and issue
systems while consuming the same portable contracts.
