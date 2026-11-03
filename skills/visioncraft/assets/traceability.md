# Traceability worksheet

Use this in the existing project record. It is a checklist of relationships,
not a new tracker or executable configuration file.

| Link | Record and verify |
|---|---|
| Product requirement → specification | Intended user behaviour, boundaries and authority |
| Specification → expectation/decision | Precise examples, counterexamples and tradeoffs |
| Work item → implementation | Owning repository and exact source revision |
| Implementation → checks/review | Supported inputs, actual executions, artefacts and dispositions |
| Release → consumer | Immutable package/source hash, lockfile and consumer execution |
| Consumer → deployment | Running version and named observed acceptance |

## Prompt or model change

Record immutable prompt/model identity, output contract, linked decision,
evaluation revision, representative/adversarial cases, metrics and raw results.
Mark a breaking output-format change for its consumers. Distinguish deterministic
assertions from rubric judgements and use successful supported controls.

## Guardrails

Specify allowed input, rejection boundaries, output constraints, private data
handling, resource limits, fallback and escalation. Identify observation signals
and response owners. An unimplemented alert or evaluator remains a proposal.
