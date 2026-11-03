# Trace requirements through delivery

This reference retains the useful traceability concepts associated with BHIL
without requiring its scaffolding tools or copying a particular tool's schema.
Use the repository's existing identifiers and tracker. Paths or URLs are valid
references; there is no requirement for a second issue store.

## Link the evidence-bearing chain

Connect the product requirement to a specification, important decision, work
item, code revision, checks, review and release observation. Keep the reverse
links useful: a changed decision should reveal affected consumers and tests.
Do not invent a record at every step if the existing issue already carries it.

For each link ask whether the referenced item exists, refers to the same scoped
behaviour and is current enough for this decision. Record supersession rather
than overwriting history. An ID proves addressability, not completion. The
[traceability worksheet](../assets/traceability.md) includes prompts, evaluations
and guardrails as ordinary linked artefacts.

## Decisions specific to AI systems

| Decision | Useful evidence and constraints |
|---|---|
| Model choice | Actual model identity, task-specific quality observations, cost/latency measurements, allowed data flow, re-evaluation trigger |
| Prompt strategy | Versioned prompt bytes, parsing/output contract, retrieval assumptions, paired evaluation and failure examples |
| Participant topology | Dependencies, concurrency limits, ownership, spend budget, cancellation and error propagation |
| Data/feature pipeline | Input/output meaning and dimensions, provenance, validation, resource budget, drift and fallback |

These are decision categories, not built-in VisionCraft services. The actual
host supplies execution and measurements.

## Choose a topology for the dependency graph

A single coordinator with workers suits separable work whose results need one
owner. A pipeline suits ordered transformations. Parallel exploration helps
compare uncertain alternatives when its cost is justified. Peer collaboration
needs explicit ownership and conflict handling. Mixed arrangements can combine
these when the task has both independent and sequential phases.

Do not infer latency, reliability or independence from the topology's name.
Record actual executions and distinguish a coordination record from a running
worker. Use only delegation already authorised by the task and environment.

## Prompts and evaluations

Version deployed prompt bytes alongside their output contract and evaluator.
Changing a required output shape can break consumers even if the prose looks
similar. Preserve immutable release versions, the linked decision, evaluation
revision, representative inputs and observed scores. Do not label a prompt
production-ready merely because an example produced plausible text.

An evaluation should cover ordinary, boundary and adversarial inputs with
explicit assertions and a named judging method. Separate deterministic shape
checks from subjective quality rubrics. Define applicability for leakage,
untrusted-input handling, refusal and recovery behaviour; a refusal-only system
must not earn a green score by denying supported requests. Run suitable controls.

Thresholds belong to the project and measured sample. Report denominators,
uncertainty and failure cases. If a required evaluator is unavailable, retain
that state rather than lowering the threshold after seeing results.

## Guardrails and operating changes

Specify accepted input, rejected input, output constraints, retained private
data, failure handling, fallback and escalation. State the authority needed for
external effects. Name observable monitoring signals and their response owner;
an alert percentage without an evaluator or action is only prose.

For a sprint, reuse the current PRD/SPEC/ADR/task scaffolding if available. Turn
acceptance criteria into expectations and tests, then carry exact code/release
references back to the work item. Migration, consumer pinning and live runtime
observations need their own evidence even after the producer's release exists.
