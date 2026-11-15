---
name: visioncraft
description: Builds features with proportionate tests and evidence, diagnoses persistent bugs, and checks engineering designs and release gates. Use for expectation-driven development, difficult debugging, imported review findings, Rust changes, browser-targeted code (Rust compiled to WebAssembly by default), Rust-native desktop and web UI with the Rune GPU framework, or a requested quality review. Simple edits and standalone prose changes do not need the full workflow.
license: MIT OR Apache-2.0
metadata:
  version: "0.3.0"
  category: "engineering-quality"
---

# VisionCraft

Make the requested change, establish what the evidence supports, and leave a
result another person can inspect. Scale the method to the change: a small
repair may need one regression and its control; a shared protocol change may
need expectations, consumer fixtures, an independent review and release checks.

VisionCraft supplies a method and a separate executable library/CLI. Reading
this skill does not start tools, install an agent fleet, change project policy,
or authorise external calls. Use the repository's actual tool and API versions.
Installed command help and package documentation describe the shipped
command surface.

## Choose the useful depth

| Situation | Read next |
|---|---|
| Behaviour is unclear or spans several requirements | [EDD](references/edd.md), [expectation template](assets/expectation.md) |
| A bug resists a straightforward fix | [Debugging](references/debugging.md) |
| No runtime exists in the task environment | [Static-oracle mode](references/debugging.md#static-oracle-mode) |
| Several writers, validators or routes may disagree | [Diagram diagnosis](references/diagram-diagnosis.md) |
| Architecture or domain boundaries need a decision | [DDD, ADR and TDD](references/methodologies.md) |
| Specifications, prompts and delivery need lineage | [Traceability](references/traceability.md) |
| An audit or reviewer supplied findings | [Review evidence](references/review-evidence.md) |
| A merge/release needs applicable checks | [Quality gates](references/quality-gates.md), [Deepsec adapter](references/deepsec.md) |
| Candidate tests, coverage gaps or measured quality tools would help | [Optional Agentic QE](references/agentic-qe.md) |
| Rust is being written, reviewed or ported | [Steering](references/rust/steering.md), [review](references/rust/review.md), [port](references/rust/port.md) |
| Code will run in a browser | [Browser targets: Rust to WebAssembly](references/rust/browser-wasm.md) |
| The UI itself should be Rust, on desktop and web | [Rune UI](references/rust/rune.md), [Rune scaffold](assets/rune-web/) |
| Several participants are actually available | [Logical roles](references/roles.md) |
| A concrete project example helps scope the work | [Five worked examples](references/worked-examples.md) |

Load only the resources needed for the task. The full
[activation template](assets/activation.md) is useful for a larger assignment;
it is not required ceremony for every edit.

## Start from the actual task

1. Read the request, repository instructions, changed files and relevant callers.
   Preserve work owned by other people. Retrieve existing project decisions
   through the host's approved knowledge tools when available.
2. Name the intended behaviour, supported configuration and important failure
   case. Search existing contracts before asking for missing information. Ask
   only when an unresolved choice materially changes the work; existing session
   authorisation remains valid.
3. Choose a check that can distinguish the defect from failed setup. Keep a
   supported positive control. If execution is temporarily blocked, retain that
   result and continue independent investigation without claiming a pass.
4. Declare the smallest adequate scope: files, consumer version, required checks,
   output location, and review policy. Security review and paid model calls
   follow the project's cadence and authorisation, not a per-edit default here.

## Implement and establish evidence

- Formulate coherent expectations before substantial implementation; use TDD
  to turn important examples into executable regressions. Prefer the existing
  implementation owner and shared contract fixtures over another copy.
- Run the failing case and read its first failed assertion. Fix the cause,
  rerun that case and its valid control, then run the relevant repository gates.
  Stop broadening tests once the applicable checks pass unless a new concern
  justifies further work.
- Preserve exact commands, raw outputs, time, full revision, relevant dirty or
  untracked bytes, features and consumed dependency versions. Distinguish the
  intended input set from what a reviewer actually inspected.
- For risk that requires independent review, identify the actual producer and
  auditor executions and their model families. Different provider names or
  role labels are insufficient. A same-family second opinion is useful but
  does not satisfy a required cross-family check.
- After two unsuccessful fixes to the same failure, reassess the hypothesis
  and seek another view if available. Do not keep editing the same symptom.
- Keep required unavailable, skipped, timed-out or inconclusive checks visible.
  They cannot become a successful gate by omitting their rows.

## Review findings and delivery

Treat imported findings as hypotheses. Preserve the original export; record
confirmation, rejection, accepted risk or inconclusive evidence beside it.
Failure to reproduce because setup is unavailable is not rejection. A clean
review is not proof of correctness.

Use the existing issue/register system. Where a structured adjacent receipt is
useful, Sealmap owns that contract:

```sh
sealmap review init findings.json --out receipts.json
sealmap review check receipts.json --json
sealmap review summary receipts.json
```

These commands require an installed compatible Sealmap. Add real observations
before claiming resolution. Its CLI checks referenced bytes and structure;
the library's structural validator does not read those files. Neither decides
whether an observation proves the claim. See [review evidence](references/review-evidence.md).

Before completion, inspect the full diff and any required independent review.
Report changed behaviour, checks actually run, remaining limits, and the next
acceptance condition. Keep source, tested, merged, published, adopted and
deployed evidence separate. Archive useful raw evidence before removing owned
temporary worktrees or caches. A reduced scope changes the denominator; it
does not complete the removed work.

## Optional integration and evaluation

[Architecture and boundaries](references/architecture.md) explains how a CLI,
repository, CI runner and reviewer can compose the method. The
[Agentbox use case](references/ecosystem-agentbox.md) describes one host's
memory, discovery, security and compatibility policies without making them
requirements for other users.

[Evaluation](references/evaluation.md) separates structural validation, public
acceptance examples and independent forward tests from measured held-out
improvement. No performance or success-rate uplift is implied by this rewrite.
Third-party Rust material retains its [full notice](references/rust/NOTICE.md).
The [migration guide](references/migration.md), [source path map](assets/legacy-paths.json)
and [file provenance](assets/provenance.json) identify retained and retired resources.
