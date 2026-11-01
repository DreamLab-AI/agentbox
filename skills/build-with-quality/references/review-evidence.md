# Review evidence: cause, version and effect

Use this reference when taking findings from an estate audit, another reviewer,
or a failing regression into implementation. It supplements the intake workflow;
it does not require a broad audit for an ordinary edit.

## Establish what the failing check proves

Read the first failing assertion and its stack before naming the reproduced
bug. A replay test that panics while formatting its first response has not yet
proved replay. Keep that run as evidence of the response failure, repair or
isolate the prerequisite, then reach the replay assertion. Retain positive
controls: rejecting every request can make rejection-only tests pass.

Distinguish build/setup failure, wrong observation, reproduced defect, and
inconclusive result. Missing runtime access or a weak fixture is not evidence
that a finding is false. Reject a finding only with a counterexample or a
source trace that contradicts it. Preserve the raw reviewer output and record
corrections in a supported disposition field or an adjacent keyed receipt.

## Resolve the implementation the consumer executes

Trace the route or entry point to the called implementation and its dependency
version. A canonical helper can exist without being called; a method named
`verify` can check a signature without enforcing replay or body binding.
Compare the consumer lockfile, vendored source or package cache before using a
sibling repository's HEAD. Before declaring upstream unreviewable, check those
local sources. Record the consumed version separately from a newer producer.

Reusing the shared implementation reduces divergence, but does not prove its
entire contract is correct. Inspect relevant policies, such as URL aliases,
raw versus reserialised bodies, optional binding, clock windows, cache scope
and error mapping. Preserve intentional compatibility boundaries or make the
policy change explicit and test its consumers.

## Follow effects beyond the return status

For stateful operations, trace authentication, admission, mutation, durable
write, secondary write, response construction and delivery. Place probes at
boundaries where an error can follow a completed effect. Check state as well
as status: an error response does not prove rollback, and a success response
does not prove delivery or settlement.

Separate identity freshness from operation idempotency. Replaying one signed
token, retrying with a fresh token, and retrying after process restart or on
another replica are different cases. Test the relevant case and name the
others as limits. Check whether rejection consumes credentials, whether a
failed operation leaves its credentials spent, and whether multiple stores
commit together. File locking does not establish transactionality or shared
replay admission.

## Read gates as policies, not verdicts about the system

Inspect the effective threshold, severity categories, skipped checks, selected
features and tested revision. A PASS can coexist with serious findings in a
category the threshold does not count. Triage every material finding, separating
pre-existing defects, regressions, accepted risks and unverified hypotheses;
do not silently change the gate threshold to obtain a green result.

When a build fails, inspect the actual target and feature set. A narrow test
command may still build a binary; disabling defaults can remove required
features. Supply only the needed pinned build inputs in an isolated checkout,
record their origin, and retry the supported configuration. Do not replace a
real dependency with a stub to get an authentication or persistence test green.
For failures outside the change, retain diagnostics and verify the affected
files are unchanged before calling them baseline failures. Report full-gate
failure separately from passing checks on the changed behaviour.

## Keep the evidence boundary when reporting progress

Record source review, executed tests, merged fixes and deployed behaviour as
separate states. An imported finding is not a newly completed review. A rendered
or citation-resolved diagram is not proof that its semantics are correct. A
scope reduction changes the denominator and earns no completion credit.

For a bounded checkpoint, retain the trigger, exact version, command and raw
result, observed state change, disposition and remaining acceptance conditions.
These are evidence fields, not a requirement to create another tracking system.
Use the estate's existing findings register and shared memory.
