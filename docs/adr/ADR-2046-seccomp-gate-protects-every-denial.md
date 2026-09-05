---
id: ADR-2046
title: The seccomp CI gate protects every established denial, not a six-name sample
date: 2026-09-05
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 89301ec7c911eab270c00a0cf81596d0d4f15535
verified_paths: []
owner: jjohare
review_trigger: any edit to config/seccomp-agentbox.json, or a new CVE requiring an argument-filtered rule
repo: agentbox
domain: SECURITY-profiles
lineage: legacy ADR-007 / PRD-003 (runtime contract and container hardening), ADR-027 (default secure posture)
---

# ADR-2046 — The seccomp CI gate protects every established denial, not a six-name sample

## Context

`config/seccomp-agentbox.json` is a supplemental denylist (`defaultAction:
SCMP_ACT_ALLOW`) layered on Docker's default profile: 46 unconditionally denied
syscalls plus one argument-filtered rule blocking `socket(AF_ALG=38, ...)` for
CVE-2026-31431 (algif_aead local privesc via `splice()`). An allowlist was
rejected deliberately — the Chromium/CUDA/Godot surface is too wide to enumerate
safely.

`scripts/ci/check-seccomp.sh` asserted only `REQUIRED="ptrace bpf mount
kexec_load unshare setns"`. The other 40 names could be deleted from the profile
without failing CI, and the CVE rule — the most specific protection in the file —
was not checked at all. Exposed by diagrams **AB-16.2** and **AB-16.3**, which
recorded the six-of-46 coverage as a `DIVERGENCE:`.

## Decision

The gate asserts the **complete** established denylist. `BASELINE` in
`scripts/ci/check-seccomp.sh` names all 46 syscalls; any removal fails CI with
the dropped names listed. The argument-filtered AF_ALG rule is asserted
structurally — an `SCMP_ACT_ERRNO` rule on `socket` with `args[0]` value `38`,
op `SCMP_CMP_EQ` — so weakening it to an unconditional or differently-filtered
rule also fails.

Adding a new denial is always permitted and is reported as an additional
denial; it never fails the gate, because tightening needs no ceremony. Removing
one requires editing `BASELINE` in the same change as the profile, which makes
the removal a deliberate, reviewable act.

The `defaultAction: SCMP_ACT_ALLOW` assertion is retained unchanged: a
well-meaning conversion to a denylist default would turn a supplemental layer
into a broken half-allowlist, so that conversion must also be deliberate.

## Consequences

- A silent narrowing of the syscall surface is no longer possible: 40 previously
  unprotected denials and the CVE rule are now load-bearing in CI.
- The profile and the gate must be edited together on any removal. That is the
  intended cost; the alternative was a gate that passed while the protection it
  named had been deleted.
- The gate still says nothing about whether the *container* is confined. It is
  not: confinement comes from `cap_drop: ALL`, `read_only: true`, uid 1000,
  `no-new-privileges:true` and Docker's own profile together
  (`docker-compose.yml:101-142`). This ADR does not change that, and AB-16.1/AB-16.2
  continue to state it.

## Verification

Verification ran on the uncommitted working tree above `verified_commit`
89301ec7c911eab270c00a0cf81596d0d4f15535 and must be re-run at the landing commit.

Positive:

```
sh scripts/ci/check-seccomp.sh
PASS (check-seccomp): defaultAction=SCMP_ACT_ALLOW; 46 unconditional denial(s)
cover all 46 established names; AF_ALG socket rule intact
```

Negative controls, run against copies of the profile in a scratch tree (the real
profile was not modified):

- Removed `userfaultfd` — a name the previous gate did **not** protect →
  `FAIL (check-seccomp): 1 established syscall denial(s) dropped from
  SCMP_ACT_ERRNO rules: userfaultfd`, exit 1. Under the previous gate this
  edit passed.
- Removed the argument-filtered rule entirely →
  `FAIL (check-seccomp): the AF_ALG socket rule is missing or altered — expected
  an SCMP_ACT_ERRNO rule on "socket" with args[0] value 38 op SCMP_CMP_EQ
  (CVE-2026-31431, algif_aead privesc via splice())`, exit 1. Under the previous
  gate this edit also passed.

Baseline extracted from the profile itself rather than transcribed: 46 names
across the `SCMP_ACT_ERRNO` rules with no argument filter, one rule with an
argument filter.

**Governed paths changed.** `scripts/ci/check-seccomp.sh`. The profile
`config/seccomp-agentbox.json` is unchanged by this ADR.
