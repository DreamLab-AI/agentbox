# VisionCraft: executable quality contracts and honest evidence

Date: 2026-11-03. Status: read-only design proposal, before implementation.

The smallest useful extraction is one Rust library and CLI that validates quality
plans, runs explicitly selected checks with bounded processes, preserves their
receipts, and evaluates gates without confusing failure, absence and success.
Its first production consumer should replace the existing Deepsec wrapper. The
second should evaluate the skill's expectation/evidence coverage contract. Agent
orchestration, semantic review and skill optimisation remain callers of this
module, not capabilities invented inside it.

This is a proposed interface and acceptance contract, not working code or a
claim that the proposed tests have run. No source repositories were changed.

## Reviewed sources and division of work

- Agentbox delivery worktree observed at
  `428da81e2a28b0cffa118082c40092d6022138af`. The inventory in
  [source-inventory.json](source-inventory.json) pins the 28-file skill at
  `4e1f4fff4e0f7827e8588c33bbf031c8420f52ad`. Comparing all recorded hashes found
  only `references/deepsec-security-gate.md` changed since that inventory.
- Sealmap 0.4 source reviewed in the delivery worktree, observed at
  `ad2e960f1f36eb2b8b63eb66ac508dae4ad30762`. This review does not attest registry
  publication or Agentbox deployment.
- The peer inventory owns exhaustive file/caller coverage and provenance. This
  document owns the domain design, adapter contract and acceptance cases. Reuse
  [callers.tsv](callers.tsv) rather than building a second migration roster.
- `skill-builder/SKILL.md:62-110` supplies the local portable-frontmatter and
  packaging contract; `skill-tuning/SKILL.md:94-119` and its
  `references/worked-trial-and-harness.md:7-34,86-107` supply the measured,
  replicated, no-leakage evaluation contract. Their source master is the
  Agentbox worktree, not the older baked Codex skill copy.

## What is actually useful to extract

| Existing source | Executable responsibility | Boundary to preserve |
|---|---|---|
| `scripts/deepsec-gate.sh:71-185` | Typed policy resolution and a review plan | Configuration describes an invocation; it does not demonstrate execution |
| `scripts/deepsec-gate.sh:187-274` | Fresh private attempt directory, bounded child execution, completion and export checks | Exit 1 alone cannot distinguish findings from runtime failure |
| `scripts/deepsec-gate.sh:276-347` | Strict finding interpretation, explicit severity threshold, receipt and exit mapping | A threshold PASS can coexist with findings; scan-only is not a review PASS |
| `EDD-PROTOCOL.md:97-110,233-275,299-319` | Expectation references, receipts, role separation, freshness, regression stabilisation | Metadata validation cannot prove a behavioural claim or that a test is meaningful |
| `references/review-evidence.md:5-24,120-146,172-213` | Cause/scope separation, completed evidence, immutable raw findings, independent delivery states | An unavailable reproduction is inconclusive, not a rejected finding |
| Sealmap `review.rs:31-239,245-339` | Existing artifact/disposition/delivery contracts and deterministic validation | Reuse these; do not invent a VisionCraft finding database or parallel disposition vocabulary |
| Sealmap `route.rs` | Existing family resolution and explicit aliases | Record the actual responder; provider or role labels alone are not independence |

The 849-line activation prompt, `config/skill.yaml`, historical npm examples,
consensus tables, claimed optimisation percentages and ML quality gates are not
an executable specification. Require a real loader, metric, evaluator and source
trace before turning any of them into a runtime feature. Treat a numerical gate
as an explicit project policy with a named measurement, not a universal fact.

## Proposed crate and API boundary

Start with a single `visioncraft` package exposing a library and feature-gated
CLI/process support. Keep deterministic evaluation usable without a process
runner, network client, database or agent framework. Split crates only if actual
dependency isolation later warrants it.

Conceptual public types, to refine before the implementation contract locks:

```rust
pub struct QualityPlan { /* version, subject, checks, expectations, policy */ }
pub struct Subject { /* repo id, full revision, dirty snapshot, configuration */ }
pub struct CheckSpec { /* id, required, invocation, evaluator, scope */ }
pub struct Invocation { /* executable, argv, cwd, env names, timeout, output limit */ }
pub struct ExecutionReceipt { /* attempt, subject, invocation, status, artifacts */ }
pub struct GateReport { /* outcomes, blocking reasons, incomplete checks, scope */ }
pub struct Expectation { /* id, scope, category, evidence refs, audit, stabiliser */ }

pub fn validate_plan(plan: &QualityPlan) -> Result<(), PlanErrors>;
pub fn evaluate(plan: &QualityPlan, runs: &[ExecutionReceipt]) -> GateReport;
pub fn check_expectations(plan: &QualityPlan, evidence: &VerifiedInputs,
                          as_of: Timestamp) -> ExpectationReport;
// Process feature; not called by validation, import, summary or report commands.
pub fn execute(plan: &ValidatedPlan, check: CheckId,
               sink: &PrivateEvidenceDirectory) -> Result<ExecutionReceipt, RunError>;
```

`VerifiedInputs` must distinguish bytes verified by the caller from unchecked
JSON. It is not a new cryptographic attestation. Use established SHA-256 code,
and reuse Sealmap's artifact/disposition types and structural validators.
Duplicate keys, duplicate IDs, unknown required fields, unsupported versions,
invalid durations, missing required checks and non-finite numeric measurements
are validation errors. Do not accept stringified booleans or silent defaults for
unreadable policy. Print diagnostics without echoing source/configuration text.

A plan names its checks; the program does not select tests from prose, spawn
agents, invent a security reviewer, send messages, deploy, or auto-accept a plan.
Human acceptance and accepted risks remain explicit referenced decisions. Prior
user/session authorisation can supply those references; the CLI must not invent
an additional approval ceremony.

Useful CLI surface:

```text
visioncraft plan check PLAN --json
visioncraft run PLAN --check CHECK_ID --out NEW_PRIVATE_DIRECTORY
visioncraft gate evaluate PLAN --receipts RUN_DIRECTORY --json
visioncraft expectations check PLAN --receipts RUN_DIRECTORY --as-of TIMESTAMP --json
visioncraft deepsec [existing Deepsec gate flags]
```

`run` consumes one selected declared check; an optional explicit `--all` can
execute the plan serially. Do not add a scheduler in the initial extraction.
`gate evaluate` and `expectations check` are read-only and never run commands
found inside receipts. Diagnostics go to stderr; JSON output is one stable
document on stdout. Evidence directories are caller-selected, not a mandatory
second project store. Native runs can use ignored `.visioncraft/`; the Deepsec
adapter preserves `.deepsec-gate/` and existing callers.

## Keep outcomes separate

| Dimension | Proposed states | Meaning |
|---|---|---|
| Process | completed, unavailable, timed-out, interrupted, failed-to-start, capture-failed | What happened to the invocation; completed includes a recorded nonzero exit |
| Evaluator | passed, blocked, skipped, inconclusive, error | What a particular check established under its policy |
| Finding | Sealmap unverified, confirmed, rejected, known, inconclusive | Assessment of an immutable imported hypothesis |
| Delivery | Sealmap source, tested, merged, published, adopted, deployed | Separately evidenced attestations; no implied progression |
| Expectation | recorded author status plus derived supported/stale/incomplete/contradicted | Never rewrite a claimed `proven` flag into truth just because it was written |

A required blocked check blocks the gate. Any other required non-pass prevents
PASS and is reported as incomplete/error. Optional failures remain visible.
Changing requiredness, scope or threshold changes the plan hash and the
denominator; it never counts as progress. A zero-check plan is invalid for a
gate. A finding-aware threshold can pass with lower-severity findings, which
must remain in counts and the linked raw export.

Native CLI exits: 0 completed policy pass; 1 completed policy block; 2 invalid
input/schema; 70 runtime/capture/evaluator error; 78 unavailable/disabled;
124 deadline; 130 interruption. Preserve the legacy wrapper's mapping where it
differs (including configuration failures to 78). Legacy scan-only can exit 0
with `SCANNED`, but its receipt cannot satisfy a required security review.

## Evidence and expectation semantics

An execution receipt binds the exact plan and input snapshot to an attempt ID,
executable identity/version, argv, working directory, allowed environment names,
start/end timestamps, monotonic elapsed duration, exit/signal, output hashes,
capture completeness, features/target and observed selection. Redact no raw
evidence silently: retain private raw bytes and produce a separately labelled
public summary when needed. Secrets must not be passed as ordinary argv values.

HEAD plus `dirty=true` is insufficient. Hash a manifest of the selected files,
including untracked files and relevant lock/config inputs. Record pre/post
snapshots; if inputs change while a check runs, do not bind its pass to the
later checkout. A declared scope is still not proof of what a scanner actually
opened. Preserve planned and observed scope independently; unknown observed
coverage stays unknown. Staged checks must actually inspect staged bytes, not
the worktree's different contents.

The expectation checker validates references, not English semantics. Require
at least one linked observation for each in-scope expectation, the reached
assertion/effect, and the declared successful control when claiming a defect
reproduction. Setup failure and observation error cannot support confirmation
or rejection. Partial/plan-only and manual observations remain distinguishable;
non-executable evidence needs a recorded human observation under project policy.

For an independent audit, require distinct execution/agent identifiers and
recognised different model families using Sealmap. A Claude-to-Claude fallback
is explicitly degraded and cannot satisfy a required independence gate. Do not
hardcode Claude producer/Codex auditor: the producer might itself be Codex.
Unknown actual model identity is incomplete, not cross-family credit. The
checker can require a separately identified adversarial probe; it cannot prove
that the auditor really devised that probe independently.

Freshness takes an injected clock and explicit policy. The current EDD text
requires ancestry, relevant-file drift and elapsed-age checks; implement those
individually and explain which failed. Do not mark all evidence stale simply
because an unrelated commit changed HEAD. Absence of a required VCS operation
is unknown, not fresh. A stabiliser reference must resolve to a declared test
and a matching successful test receipt; existence of a string is not execution.

Sealmap integration has a real API limitation: `sealmap-corpus::review` exposes
shape validation but the filesystem/hash verification lives in private
`crates/sealmap/src/review_cli.rs:56-145`. For the initial adapter, invoke
`sealmap review check` for imported disposition receipts and preserve its exact
result; unavailable Sealmap is unavailable verification. For library-only
consumers, a small follow-up public artifact-resolver API in the owning crate
would remove that binary dependency. Do not claim `review::validate` already
verifies bytes, copy its entire validator, or force that follow-up into the
Sealmap release currently being finished.

## Deepsec compatibility adapter

Retain the existing script path as a tiny quoted `exec visioncraft deepsec "$@"`
shim after acceptance. Keep the existing flags, env variable names, policy
precedence, report filenames, legacy result names and exit mappings. A clean CI
run with no Agentbox manifest currently uses defaults; distinguish that supported
absence from an explicitly supplied unreadable/malformed manifest. Reject
multiple mutually exclusive modes instead of today's last-mode-wins parser.

Generic VisionCraft consumes a typed Deepsec policy. Only the Agentbox adapter
reads `[security.deepsec]`, `AGENTBOX_CONFIG`, `DEEPSEC_GATE_*`, baked-tool
availability and estate paths. Do not put the entire Agentbox manifest parser,
model defaults, network addresses or registration machinery in the portable
library. The reviewed tool contract is Deepsec 2.3.10; mismatched versions need
fixture-backed compatibility rather than assumptions from stale comments.

Before invoking any model, resolve the requested file list relative to the
invoking directory, validate policy/paths, create a unique private attempt
directory and record the plan. Preserve separate attempt storage and resumable
tool state. Parallel attempts must not overwrite shared config/data; isolate
state per attempt, or explicitly lock a named resume workspace. Resuming is an
explicit mode referring to an earlier plan, not accidental reuse by repo name.

The adapter must support the overloaded Deepsec exit 1 protocol: only a fresh,
nonempty per-invocation comment from the pinned completion path, followed by a
successful valid nonempty export, establishes a completed findings run. Exit 0
still requires a valid export. Unknown shapes/severities, export errors,
missing completion and truncated output cannot become empty findings. An
interrupted/error attempt preserves logs and a non-PASS receipt even when the
tool exported partial discoveries. Exit 1 plus a stale comment is an error.

Keep Deepsec's severity order explicit and versioned, including `HIGH_BUG` and
`BUG`; show both the counts and blocking threshold. Preserve the raw aggregate
export unchanged. Deepsec findings may lack the unique `id` required by Sealmap
(`review.rs:245-262`), so write a separate normalised review view with stable
within-export IDs derived from the raw export hash and JSON pointer, plus a
mapping back to those raw bytes. This is not cross-run deduplication. Keep
historical/unattributed findings distinct from evidence completed this attempt;
a refreshed run ID is not a revalidation receipt.

## Process and filesystem contract

- Invoke a resolved executable with argv, not shell text. Shell mode, if ever
  supported, must be explicit; validation/reporting never evaluates it.
- Use bounded streaming capture for stdout/stderr. Record separate raw streams
  and completeness. On capture failure or limit breach, stop the process group,
  preserve captured bytes, and record error; do not let a late exit 0 turn it
  into a pass. ANSI/control sequences are data, not terminal instructions.
- Apply one monotonic deadline to the whole adapter attempt, including version
  probes and exports. The existing full-mode scan and process each receive the
  full duration separately; the new total deadline is an explicit policy change.
- On deadline/cancellation, signal the process group, allow bounded checkpoint
  grace, kill remaining children and reap them. A returned CLI must not leave a
  provider subprocess spending in the background. Other platforms need a tested
  equivalent or explicit unsupported result, not guessed POSIX behaviour.
- A runner is not a sandbox. Commands have the invoking user's authority unless
  the caller supplies an actual sandbox. Record that boundary. Do not expose
  untrusted receipt commands through a generic 'replay everything' operation.
- Allowlist environment names, with explicit per-adapter credentials passed
  only to the needed child. Resolve values at execution; do not persist them,
  interpolate them into generated JavaScript or print them in diagnostics.
  Preserve documented subscription-auth paths through explicit adapter inputs.
- Use unique exclusive directories, restrictive permissions, atomic receipt
  finalisation, regular-file checks and root confinement. Refuse final/parent
  symlinks on managed output paths. Retain legitimate explicitly chosen
  canonical workspace roots. Failure to finalise evidence cannot yield PASS.
- Keep source-bearing prompts/logs private and ignored before capture. No
  automatic publication, credential discovery or network routing. Publishing
  an authorised review's input is a separate action from running that review.

## Executable acceptance cases before replacement

Run offline against controlled child programs and temporary Git repositories.
Port the current 16 Deepsec wrapper tests as behavioural fixtures first; keep
the wrapper and candidate adapter behind the same harness until compatibility
is demonstrated. Source-changing fixtures use sentinel text, never real secrets.

| ID | Fixture / action | Required observation |
|---|---|---|
| A01 | Valid empty completed export | PASS, zero findings, valid raw hashes, no omitted required check |
| A02 | HIGH and MEDIUM findings under HIGH threshold | HIGH blocks; MEDIUM remains counted on PASS |
| A03 | Exit 1 without fresh comment; old comment present elsewhere | Runtime error, never PASS, retained raw partial output |
| A04 | Exit 1 with comment and valid findings | Completed findings run; threshold decides block/pass |
| A05 | Export fails, is truncated, has duplicate IDs or unknown severity | Error with preserved evidence, not an empty result |
| A06 | Disabled/missing executable/missing credential | 78, no model invocation; reasons remain distinct |
| A07 | Relative file-list path, whitespace paths and staged/worktree divergence | Correct intended bytes reach reviewer, actual scope recorded |
| A08 | Reused output directory and concurrent resume workspace | Refuse reuse or serialize explicitly; no cross-attempt artefacts |
| A09 | Child spawns sleeping grandchild and exceeds deadline | Complete group stopped/reaped; timeout receipt; no remaining process |
| A10 | Unbounded stdout, broken sink and cancellation | Bounded capture or explicit failure; no deadlock or false PASS |
| A11 | Symlinked output parent/final file, malformed secret-like config | Refusal without external write or sentinel disclosure; ordinary output succeeds |
| A12 | Literal argv containing backticks, dollar substitution and semicolons | Child receives literal bytes; no extra command executes |
| A13 | Selected source edited during run; unrelated commit after run | First result stale/mismatched; second evaluated under relevant-input policy |
| A14 | Required skipped/inconclusive gate; optional failure | Aggregate never PASS for missing required evidence; optional failure remains visible |
| A15 | Setup failure called rejected; source repair called deployed | Existing Sealmap disposition validation refuses unsupported claims |
| A16 | Same family via different provider aliases; unknown responder | Required independence unmet; genuine distinct-family control succeeds |
| A17 | Missing/invalid stabiliser and duplicate expectation IDs | Explicit coverage errors; valid referenced executed test succeeds |
| A18 | No AGENTBOX_CONFIG vs explicitly bad config; conflicting modes | Preserve supported CI defaults only for absence; malformed/config conflicts refuse |
| A19 | Historical export row plus one newly reviewed row | Raw aggregate retained, current-attempt claim does not swallow historical evidence |
| A20 | Library-only import and report execution on receipt with command text | No child, no network, no memory/issue-store writes |
| A21 | Generic Rust fmt/clippy/test plan on a tiny fixture | Receipts work without Agentbox, Deepsec or a model provider |
| A22 | Mutated referenced evidence after success | Byte verifier reports mismatch; old receipt does not certify new bytes |

Acceptance is all mandatory contract cases passing, not an arbitrary coverage
percentage. Add property tests for policy aggregation, duplicate/unknown field
handling, duration/output bounds and path grammar. Maintain positive controls
alongside refusals so rejecting everything cannot earn a green suite.

## Held-out evaluation and skill packaging

The table above is public acceptance material, not held-out evidence. Before
implementation, an independent curator should freeze separate fixtures covering
the same contracts with different process trees, file layouts, malformed
exports, dirty/staged combinations and provider aliases. Seal their hashes and
withhold their contents/expected answers from the implementer. If any are shown
during debugging, reclassify them as regression tests and replace the held-out
case. No claim of held-out success can be made from this document.

For the portable skill, compare current instructions with the proposed pack on
paired tasks: failed setup vs defect; wrong consumer revision; degraded audit;
partial scan vs completed review; a small ordinary fix needing no review ledger;
and a genuinely non-executable hardware observation. Score both hard success
and partial contract satisfaction, preserve all trajectories and run at least
three replications per item as the local tuning method prescribes. Report
per-item results and uncertainty; do not promise an uplift before measuring it.
Keep train/validation/test separate; no reference solution, hidden fixture or
other arm's outcome may enter the optimiser's packet. Do not port the existing
Python SkillOpt trainer merely to make this crate larger.

Portable packaging should contain `SKILL.md`, directly linked `references/`,
templates under `assets/`, the actual CLI usage and an eval-suite reference.
Use portable core frontmatter with string metadata; put Codex UI policy under
`agents/openai.yaml` and estate registration details in the Agentbox adapter.
An optional executable wrapper may invoke the installed CLI; it must not carry
a second evaluator implementation. Keep internal absolute paths, model pins,
memory servers and host-network addresses out of the generic pack. Retain a
thin `build-with-quality` compatibility skill at its established registration
point, then update the full caller inventory, routers, generated indexes, Rust
stack embedding and CI together. Do not silently change prompt-time routing.

## Provenance, release and adoption conditions

The source repository root is AGPL-3.0, while the build-with-quality entry point
and README claim MIT. The wrapper has no separate file-level licence notice.
The BeautifulRust subtree does have a complete MIT notice and pinned upstream
revision (`references/rust/NOTICE.md`). Matt Pocock/BHIL attributions do not, by
themselves, establish a redistribution grant for their wording. These are
observed provenance gaps, not a legal conclusion that any particular copy is
permitted or prohibited.

Before publishing a permissive extraction, establish a file-level provenance
and licence decision for copied material. Preserve the BeautifulRust notice if
included; retain its pinned-source information. Write new core code from this
behavioural contract and test fixtures rather than mechanically copying the
AGPL wrapper under a new licence. Keep Agentbox-specific adapter code in its
existing licensed repository unless its provenance is explicitly resolved.
Sealmap's `MIT OR Apache-2.0` dependency is separately declared and does not
resolve Agentbox's own file licensing.

Release readiness requires the implemented API/rustdoc, ordinary crate
metadata and licences, offline regression/property tests, cross-family review
of the actual final diff, and executed compatibility fixtures. Adoption then
requires the real registry version in the Agentbox lock/build, the shim used
by existing callers, and a harmless live end-to-end smoke receipt after the
rebuilt image runs. Published, consumed and deployed remain separate facts.
Remove obsolete npm APIs, inert 'runtime config' claims and unsupported
performance promises as part of the migration, not as a later documentation
cleanup. Preserve meaningful methods as guidance where no executable contract
exists; do not give them nominal function names to suggest implementation.
