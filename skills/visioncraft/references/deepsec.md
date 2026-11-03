# Security review through a bounded adapter

Deepsec is an external reviewer, not part of the skill's reasoning runtime.
Use a compatible installed adapter under the project's source-sharing, model
and spend policy. Running a full paid review after every edit is not the
default. A required security review and a cheap candidate scan are different
checks.

Compatibility is based on the inspected Deepsec 2.3.10
protocol. Consult the installed version's own help/documentation before changing
its flags or result interpretation. A later version needs compatibility evidence.

Deepsec remains an optional upstream dependency, maintained by its own project.
VisionCraft does not fork its reviewers. The package's `contracts/deepsec.json`
pins npm version, upstream commit, integrity and protocol-fixture version; the
package's `docs/UPSTREAM-DEEPSEC.md` gives the update procedure. Read bundled
release documentation, compare flags/configuration/exports/exits/model routes,
run completion and failure fixtures, perform an authorised bounded real smoke,
then align exact host pins before release and rebuild. A release monitor may
propose a PR; it must not auto-activate or start paid work.

## Declare the attempt

Choose exactly one supported scope/mode, the base revision or file list,
required threshold, tool/model configuration, total deadline, capture limits
and a fresh private output directory. Resolve relative input paths against the
invoking directory before an adapter changes working directory. Preserve
relevant dirty/untracked bytes and configuration with the plan.

Resolve credentials by approved names at execution time. Do not write secret
values into plans, command-line arguments, diagnostics or public evidence.
Explicit malformed configuration is an error, not permission to fall back to
permissive defaults. A host can support absent optional config without treating
an explicitly requested unreadable manifest as absent.

## Determine completion before counting findings

Deepsec's inspected protocol overloads exit 1: findings and runtime/input/provider
failure can share it. Interpret it as completed findings only with the pinned
completion path's fresh, nonempty comment from this invocation and a valid
successful export. Exit 0 also needs a valid export. Never use an old comment,
empty fallback array or unrecognised parser output as evidence of a clean run.

Retain the original export and per-attempt output. Reject malformed rows,
unknown severities and incomplete/truncated capture. Keep severity order and
threshold explicit, including bug categories such as `HIGH_BUG` and `BUG`.
A policy pass means no counted finding crossed that threshold, not zero
findings or a secure system.

VisionCraft also requires persisted completion evidence for the frozen file
set: one fresh completed processing run, matching project/root and processed
count, exact path/hash `analyzed` file records, and current-run history with
model/agent identity, positive output tokens, explicit non-refusal and no
skipped scope. A fresh comment alone is insufficient. Direct mode processes the
explicit files with `--no-ignore`; staged/working byte mismatches are refused.
Full mode processes scanned pending candidates; an empty set is unavailable,
not a successful full review. Retain those raw records alongside the export.

Legacy outcome conventions are 0 for completed policy pass (or separately
labelled scan-only completion), 1 for blocking findings, 70 for runtime/export
error, 78 for disabled/unavailable/configuration refusal, and 124 for deadline.
Use the actual adapter's documented mapping for cancellation and other invalid
input. A scan-only result must not satisfy a required model review.

## Retain scope and history

Compare planned files, observed reviewed scope and final changes. Working-diff
mode alone does not establish coverage of untracked inputs. A small diff may
lead a reviewer to inspect a whole file; source traces decide whether a finding
is new, pre-existing or unreachable under the selected configuration.

Resumed or reused state can export historical findings. Keep the aggregate
unchanged and identify current-attempt observations separately. A fresh run ID
does not revalidate every row. A prior failed attempt's comment cannot prove
this attempt completed. Isolate attempts or use explicit controlled resume
semantics so concurrent reviews cannot overwrite evidence.

If raw rows lack unique IDs, retain a separate normalised view with IDs tied to
the raw export hash and row location; preserve the mapping. Do not claim this
deduplicates independent runs. Feed findings through
[review evidence](review-evidence.md) and Sealmap dispositions.

## Validate the failure protocol

Keep controls for a completed empty review and a completed real finding beside
cases for invalid inputs, unavailable provider, absent/stale completion,
malformed export, unknown severity, timeout and interrupted capture. A gate
that rejects everything is also broken. Test path/argv handling, total deadline
and child cleanup with local controlled executables before replacing a consumer.

This adapter does not provide a source sandbox, certification or deployment.
Revalidation, dynamic testing and production acceptance remain separate work
when required. Source-bearing artefacts stay private unless publication is
explicitly authorised. [Agentbox](ecosystem-agentbox.md) adds its own integration
policy and legacy-path handling.
