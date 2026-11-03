# Select and interpret quality gates

A gate is a project policy evaluated against observations. It is neither a vote
nor a guarantee that the system is correct. Choose required checks before the
result is known, from the changed behaviour, consumers and governing policy.

## Applicable check families

| Check | Establish the policy and evidence |
|---|---|
| Pre-implementation | Scope, important expectations, interfaces, relevant decisions and supported environment |
| Pre-merge | Meaningful regressions/controls, supported features, formatting/lints, contract compatibility and scoped coverage |
| Security | Threat boundary, actual source selection, completed reviewer/scanner result, known severity vocabulary and threshold |
| Accessibility | Relevant interaction requirements, tested user journeys and applicable standard criteria; automated findings plus required manual observations |
| Resilience | Explicit failure model, workload, recovery/loss limits and observations during network/resource/dependency faults |
| Evidence coverage | Original expectation denominator, actual observations, required independence, freshness and executed stabilisers |

Coverage percentages, compliance claims, latency budgets and reliability targets
are not universal defaults. A line-coverage number does not show that assertions
test the right behaviour. Use mutation testing or targeted counterexamples when
they answer a real uncertainty. Defect prediction needs a named model, labelled
data and a measured result; the skill itself has no prediction engine.

## Readiness profiles

A prototype can explicitly exclude deployment, independent review or resilience
work when the task permits it; retain correctness checks for supported behaviour
and do not describe the result as production acceptance. Ordinary maintenance
usually needs a focused regression, compatibility checks and required repository
gates. A critical protocol/state change may need EDD, consumer fixtures, an
independent audit and recovery/migration acceptance. The profile selects work;
it does not pre-populate successful evidence.

## Workflow through the gates

Clarify intent and domain boundaries, record the expectations that matter,
implement with a testable feedback loop, produce evidence, perform applicable
review and challenge, stabilise important scenarios, then assess release and
consumer acceptance. Use an advisor before locking a difficult interface,
after repeated failed repairs, or over the final diff when available and useful.
A same-family advisor does not discharge an independent-audit requirement.

Checks may run alongside implementation when independent, but preserve a final
subject revision and configuration. Paid external review follows the current
project's cadence; do not run it automatically after every increment. A check
before later edits must not be presented as review of the final diff.

When available, [AQE's direct tools](agentic-qe.md) can propose tests and explain
coverage gaps. Preserve the generated source and measurement provenance, then
run the real project tests and instrumentation. Its static analysis and fixed
seven-metric gate have different contracts; unavailable measurements must not
satisfy the project's required checks. Keep the complete raw MCP response
beside subsequent native test evidence.

## Outcome dimensions

Record process completion separately from evaluator judgement. A process can
finish with an error, a scanner can produce incomplete output, and a threshold
can pass while lower-severity findings remain. Required missing, skipped,
unavailable, timed-out, contradictory or inconclusive evidence prevents a
complete pass. Optional findings remain visible even when they do not block.

Display the required checks, effective threshold, source selection and original
denominator. Changing requiredness or scope is a policy change, not earned
completion. A zero-check gate is not evidence of readiness. Preserve failed
invocations and capture failures rather than interpreting them as empty results.

## Imported findings

Preserve the raw export. Determine the actual assertion, consumer version and
effects before choosing a disposition. Code defects enter the regression loop;
incorrect diagrams need source-backed corrections and rendering/citation checks;
accepted risks need the appropriate decision reference; missing evidence stays
inconclusive. Use [review evidence](review-evidence.md) and the existing register.

Sealmap 0.4 supplies adjacent finding receipts and independent delivery
attestations. `sealmap review check` validates schema/artefact integrity;
`--require-resolved` additionally requires no unverified or inconclusive findings.
It must not force a fabricated rejection. Its library validator checks structure
only; the CLI additionally resolves and hashes files. These checks do not judge
the truth of the observation or the authority of a self-reported decision.

## Finish at an evidenced boundary

Report changed behaviour, meaningful tests and their scope, required gates that
passed or remain unresolved, and accepted risks. Keep source, test, merge,
publication, consumer adoption and deployed behaviour separate. Save reusable
lessons through the host's existing knowledge system if available, with source
and limits. Do not claim automatic learning or improved success rates from
writing a lesson. Archive private evidence before deleting owned scratch work.
