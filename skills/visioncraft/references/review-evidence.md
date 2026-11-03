# Review evidence: establish cause, subject and effect

Use this when turning an external audit, code review or failing regression into
work. It is an intake method for substantial findings, not an instruction to
audit the entire estate for every small edit.

## Reach the claimed failure

Read the earliest failing assertion and stack. A replay test that fails while
formatting its first response has established a response failure, not replay.
Retain that observation, repair or isolate the prerequisite, and reach the
intended assertion. Keep a valid success control: rejecting all requests can
make rejection-only tests pass.

An existing test may encode a defect. File existence can conceal unusable
permissions; successful creation can conceal a missing secondary record. Before
changing expected output, identify the contract and inspect the resulting state
or access decision. Separate fixture repairs from product repairs.

Classify setup failure, observation error, product failure and uncertainty.
Unavailable runtime access is not evidence against a finding. Reject only with
counterevidence or a source trace that contradicts the claim. Preserve the
reviewer's original bytes and make corrections in supported dispositions or an
adjacent keyed receipt.

## Trace the consumer and authority

Follow the real entry point to the called helper, build features and dependency
version. A canonical verifier can be present but unused. A function called
`verify` might check a signature while omitting body binding or replay policy.
Use the consumer lockfile, package cache or vendored source before assuming a
sibling repository's newest commit runs in that consumer.

For source-pinned packages, reconstruct the archive's layout and use its actual
lockfile. Check each consumer whose pin moves. One workspace can compile while
another fetches an old revision or exposes an incompatible dependency type.
Stale local comments do not establish third-party behaviour.

Shared code still needs its relevant policy checked: aliases, raw versus
reserialised bodies, optional binding, clock windows, cache scope and errors.
Record deliberate compatibility differences and run their fixtures. Wiring a
previously broken reader can expose data to an authority the original broken
lookup concealed; test access through the repaired route and a correctly wired
component control.

Hidden discovery is not denied access. Try a known identifier, and inspect
shared transport settings that may override component policy. A subprocess
probe establishes that layer; end-to-end exposure needs the consuming route.

## Publication, quarantine and migration

If a verdict occurs after storage, enumerate all readers: raw and rendered
views, protocol routes, local object APIs, indexes, exports, archives and
backups. A transport denial does not govern the other readers. Integrity
validation does not by itself stop publication.

Keep candidate bytes outside every served namespace until approval, then
publish only the approved records/closure. Test a valid published control,
rejected known-identifier access, and reads while validation is pending. For
old data, test migration from a pre-repair fixture. Removing an index row does
not remove already addressable objects. Define conflicts and recovery, preserve
approved roots and quarantine recoverable old data outside served storage.

## Consolidate the actual shared contract

Compare inputs, outputs, trust boundaries, effects and callers before calling
paths duplicates. A reusable credential and a one-request token can have
different replay rules; a login challenge need not implement request signing.
Classify each path as live, partly wired, retired or already repaired at the
examined revision. Retain rejected duplication candidates with reasons.

Trace reads and writes together. An unwritten settings store, vectors never
populated for retrieval, or membership deletion that leaves an identity index
is a broken journey even if isolated components pass. Prefer the existing
shared owner and run the same contract fixtures through real adapters. Pin time
and bytes for signed fixtures. Shared fixtures can prevent drift before shared
implementation is practical.

Follow discovery links emitted to clients in integration tests. Writing to a
guessed path can hide a faulty advertised one. After mutation, exercise the
consuming read or policy decision with allowed and denied callers.

## Effects survive error responses

Trace identity, admission, mutation, primary/secondary durable writes, response
construction and delivery. Observe state on both sides of boundaries where an
error follows a completed effect. Error does not imply rollback; success does
not establish delivery or settlement.

Separate token replay from operation idempotency. Retrying the same signed
token, using a fresh token for the same operation, retrying after restart and
retrying on another replica are different tests. Check whether rejection spends
credentials and whether stores commit together. A file lock does not establish
transactional effects or distributed replay admission.

## Reviewer completion and threshold semantics

An empty list is meaningful only after a completed review with a valid export.
Missing completion, parser mismatch, quoted success markers, quota errors,
truncated output and export failure remain errors. If a tool reuses an exit
code for findings and runtime failure, require fresh completion evidence from
that invocation. Keep both empty-review and real-finding positive controls.
Unreadable/corrupt spend records must not become an empty paid-review ledger.

Compare reviewer agreement only for equivalent bytes, scope, visible register
and recognised actual model families. Provider aliases, filenames and similarity
clusters do not demonstrate independence. Agreement ranks hypotheses; it does
not verify them.

Inspect effective severity categories, threshold, skipped checks, feature set
and tested revision. A threshold pass may coexist with material uncounted
categories. Distinguish pre-existing defects, regressions, accepted risks and
unverified findings; do not quietly lower the threshold for a green result.
Likewise, a changed hunk can trigger whole-file analysis without making every
finding a regression introduced by that hunk.

Resumed work may export old findings with new run metadata. Compare current
completion evidence and actual source to the aggregate; a refreshed run ID is
not item-by-item revalidation. Keep raw history and current dispositions apart.
Severity labels alone do not prove exposure: identify reachability, selected
build, caller authority and demonstrated effect. Fail-closed refusal may still
be a functional defect in a supported journey.

## Build and capture failures

Inspect the actual target and features: a narrow test can build a binary, while
disabling defaults can remove requirements. Supply needed pinned inputs in an
isolated checkout. Do not replace authentication or persistence dependencies
with stubs just to make checks green. Before calling a failure baseline-only,
retain diagnostics and establish that the relevant files were unchanged.
Report full-gate failure separately from passing focused tests.

Budget disk alongside CPU when several workspaces compile. After exhaustion,
check source writes and receipts for truncation before retrying. Restore known
reviewed bytes, rerun affected checks, and reclaim only owned caches after
preserving evidence. Another worker's build directory is not spare space.

## Close out without changing the claim

Keep finding IDs and the raw export hash bound to the same bytes. Evidence of
an unrelated successful consumer cannot support adoption when the real consumer
failed. Preserve source-bearing prompts/logs outside publication directories;
permission to call a model is not permission to publish its inputs.

A source review, rendered diagram, imported finding, test, merge and deployed
repair are different observations. A scope reduction changes the denominator
and earns no completion credit. Handoffs retain trigger, exact revision/config,
command and raw result, effect, disposition and remaining acceptance conditions
in the existing project register.

For changed contracts, test minting helpers, examples and downstream callers as
well as the verifier. Check immutable build artefacts, upload, registry release,
consumer lock resolution and running activation independently. After local
path-patched integration, remove that patch and exercise the actual released
consumer source/checksum before claiming adoption. Reuse checksum-verified
release artefacts where the release contract requires them; do not silently
substitute locally compiled bytes for a reviewed toolchain pin.

Naming/discovery repairs do not migrate prior state. Define precedence,
conflicts and recovery for records under the old convention. For permission
data, verify both retained owner access and denied access after migration.
Record producer repair and migration acceptance separately.
