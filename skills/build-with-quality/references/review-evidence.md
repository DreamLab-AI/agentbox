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

An existing test can preserve the defect: successful creation or file existence
may conceal unusable permissions. Before changing its expectation, identify the
contract it should protect. Retain a valid success case and add the rejected
case, then assert the resulting access or state. Record fixture repairs
separately from product repairs so a setup failure earns no regression credit.

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

For a packaged source dependency, reconstruct the recipe's exact archive layout
and run with its committed lockfile. Test all consumers whose source pins move
together. One successful workspace build can conceal a stale fetch revision or
a second consumer's incompatible public dependency type. Confirm scanner claims
about third-party helpers against the installed, lock-pinned implementation;
stale local comments are not evidence of that dependency's current behaviour.

Reusing the shared implementation reduces divergence, but does not prove its
entire contract is correct. Inspect relevant policies, such as URL aliases,
raw versus reserialised bodies, optional binding, clock windows, cache scope
and error mapping. Preserve intentional compatibility boundaries or make the
policy change explicit and test its consumers.

When repairing routing or wiring, check what authority will reach the newly
selected data. A broken lookup can mask an insufficient permission check;
repairing selection alone can activate that defect. Exercise the actual route
and a correctly wired component control, then distinguish current exposure
from exposure the proposed repair would introduce.

Hiding an identifier from discovery does not prove that a caller who knows it
cannot retrieve the object. Check direct access and the effective settings of
shared transports, including overrides applied after a component configures
its own policy. A subprocess reproduction establishes that layer's behaviour;
trace and test the consuming route before claiming end-to-end exposure.

When a verdict is made after bytes enter storage, enumerate every reader of
that storage: protocol adapters, local object readers, raw and rendered views,
APIs, archives, indexers and backups. A denial in one transport does not govern
the others. Integrity validation is also distinct from publication control;
confirm whether rejected input is quarantined, removed, or left addressable at
rest. Exercise a valid published object as a control, a rejected object by its
known identifier, and reads while validation is still in progress.

For a repair, keep candidate data outside every served store and publish only
the approved closure or record set. Then address existing data separately:
removing hidden references or index rows does not erase objects already held in
the old served store. Test migration from a pre-repair fixture, preserve the
approved roots, retain recoverable old data outside the served namespace, and
repeat the known-identifier denial after migration.

## Compare contracts before consolidating implementations

Group suspected duplicates by the contract they implement: inputs, outputs,
trust boundary, side effects and callers. Similar names or shared cryptography
do not establish the same protocol. A reusable repository credential and a
single-request token can intentionally have different replay policies; a login
challenge need not be another HTTP-signature verifier.

For each group, record which paths are live, partially connected, retired or
already corrected at the reviewed revision. Keep rejected duplicate candidates
with their reasons so later reviewers do not rediscover them. Trace both writes
and reads: a settings reader with no writer, an index without populated vectors,
or a deletion that leaves a secondary identity index is a broken journey even
when each component passes its own tests.

Where implementations really share a contract, reuse the estate's existing
owner and run shared fixtures through the actual consumer adapters. Pin time
and input bytes in historical signed fixtures. Preserve intentional differences
as explicit policy cases. A shared test corpus can expose drift before a shared
implementation is practical; moving code alone does not prove migration.

For discovery-based protocols, follow the link or identifier returned to the
client in an integration test. Writing to a guessed canonical path can hide a
broken advertised path. After the write, exercise the consuming read or access
decision with both permitted and denied callers; a successful write alone does
not establish that the consumer uses the changed state.

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

Require a completed response before interpreting an empty finding list. A
parser that recognises no headings has not established a clean review. Reject
ambiguous verdicts and quoted success markers, preserve incomplete replies, and
keep their findings unverified. Corrupt or unreadable spend records must not
become an empty ledger that opens a paid review gate.

Compare reviewer agreement only for equivalent input snapshots, scope and
register visibility, using the recorded models' recognised families. File names,
provider aliases and transitive similarity clusters do not establish independent
corroboration. Even a valid comparison ranks hypotheses; it does not verify them.

Keep successful evidence and its subject together. A successful unrelated probe
cannot support adoption when the observation of the actual consumer failed.
Bind parsed finding IDs and the original export hash to the same byte snapshot.
Preserve source-bearing prompts and logs outside publication directories; an
authorised model call does not authorise publishing its input in a public repo.

Inspect the effective threshold, severity categories, skipped checks, selected
features and tested revision. A PASS can coexist with serious findings in a
category the threshold does not count. Triage every material finding, separating
pre-existing defects, regressions, accepted risks and unverified hypotheses;
do not silently change the gate threshold to obtain a green result.

A resumed review can export historical findings with refreshed run metadata.
Compare the per-run narrative/comment and the actual source with the aggregate,
rather than treating a new run ID as proof that every item was revalidated.
Keep the raw export and record reproduced, repaired, contradicted and remaining
items separately. A small changed hunk can also cause a reviewer to inspect an
entire file: distinguish an unrelated existing issue from a regression before
expanding the repair scope.

Separate a severity category from demonstrated exposure. Record whether the
path is reachable in the selected build, which authority reaches it, and what
the observed failure permits. A cryptography label or unsafe helper alone does
not prove an exploitable route; a fail-closed refusal still merits a functional
finding when it blocks a supported journey.

When a build fails, inspect the actual target and feature set. A narrow test
command may still build a binary; disabling defaults can remove required
features. Supply only the needed pinned build inputs in an isolated checkout,
record their origin, and retry the supported configuration. Do not replace a
real dependency with a stub to get an authentication or persistence test green.
For failures outside the change, retain diagnostics and verify the affected
files are unchanged before calling them baseline failures. Report full-gate
failure separately from passing checks on the changed behaviour.

Budget disk as well as CPU when several Rust workspaces build concurrently.
After an out-of-space error, inspect interrupted source writes and receipts for
truncation before retrying. Recover from the known reviewed content, then rerun
affected gates. Preserve evidence before reclaiming only task-owned caches;
another worker's build tree is not available cleanup space.

## Keep the evidence boundary when reporting progress

Record source review, executed tests, merged fixes and deployed behaviour as
separate states. An imported finding is not a newly completed review. A rendered
or citation-resolved diagram is not proof that its semantics are correct. A
scope reduction changes the denominator and earns no completion credit.

For a bounded checkpoint, retain the trigger, exact version, command and raw
result, observed state change, disposition and remaining acceptance conditions.
These are evidence fields, not a requirement to create another tracking system.
Use the estate's existing findings register and shared memory.

A producer fix remains distinct from a released package, a consumer lockfile
update and a running deployment. For a contract change, check minting helpers,
examples and downstream callers as well as the verifier; a stale example can
leave the supported user journey broken after the library tests pass.

Verify release stages independently: build, immutable artefact upload, registry
publication and consumer lock resolution can succeed or fail separately. A
retry should reuse an already released, checksum-verified bundle where that is
the repository's release contract. Do not substitute locally built bytes from
a different compiler for a reviewed toolchain pin. After local path-patched
integration tests, remove the patch and run the real registry consumer before
claiming adoption; its lockfile must contain the released source and checksum.

Correcting discovery or storage naming does not migrate existing data. Identify
records written under the old convention and define conflict handling and
recovery before changing precedence. Report the producer repair separately
from migration acceptance; for permission data, verify owner access and denied
access after migration rather than assuming either filename is authoritative.


### A reviewer failure cannot become an empty review

Exercise the gate's error protocol as well as its successful result parser.
Input errors, provider failures, missing exports and truncated JSON must remain
errors. Some tools reuse the findings exit code for runtime failures: verify
completion using fresh evidence from that invocation, never an earlier comment
or an empty fallback array. Keep a no-finding positive control and a real-finding
control beside the failed-invocation regression. This caught a false PASS in the
Deepsec wrapper during the Sealmap 0.4 release review.
