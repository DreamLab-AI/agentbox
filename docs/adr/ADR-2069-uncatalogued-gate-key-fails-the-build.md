---
id: ADR-2069
title: An uncatalogued manifest gate key fails the build, against a baseline that may only shrink
date: 2026-09-05
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: e070514d808b218574403377fb75e0e1a0a256b3
verified_paths: []
owner: jjohare
review_trigger: a new boolean key is added to agentbox.toml, or a BASELINE entry is added rather than removed
repo: agentbox
domain: GOVERNANCE-capabilities
lineage: legacy ADR-039 (system-manifest apply-class catalogue), ADR-2057 (close the capability gate gaps), ADR-2052 (cite the manifest by key, not line)
---

# ADR-2069 — An uncatalogued manifest gate key fails the build, against a baseline that may only shrink

## Context

The system-manifest `CATALOGUE` (`management-api/lib/system-manifest.js`) is
hand-authored documentation-as-data: it is what `/v1/system` reports a capability's
state from. `scripts/ci/check-manifest-catalogue.js` already failed on a catalogue
entry whose gate path does not resolve, but a gate key in `agentbox.toml` with **no**
catalogue entry was only a `WARN`. A warning nobody must act on is not a gate: at
`e070514d8` the check printed **130** uncatalogued boolean keys and exited 0, so a
new capability could be added, shipped and forgotten without ever appearing in the
system view. ADR-2057 closed three specific gaps; it did not close the mechanism
that let them open.

## Decision

An `agentbox.toml` boolean key that has neither a `CATALOGUE` entry nor an entry in
an explicit `BASELINE` in `scripts/ci/check-manifest-catalogue.js` **fails the check
(exit 1)**, carrying the same message the warning carried.

The `BASELINE` is a ratchet, not an escape hatch, and is enforced as one:

- a baseline key that has since gained a `CATALOGUE` entry **fails**;
- a baseline key that is no longer a boolean in `agentbox.toml` **fails**;
- a key listed twice **fails**.

So the list can only ever shrink, and a stale entry is a build error rather than
sediment. Every entry sits in a group carrying a reason that must be true:
sub-option of a catalogued parent; provider credential toggle; upstream crate build
feature; operator policy or attestation knob; and — the honest one — **UNCATALOGUED
CAPABILITY**, printed as a `WARN` on every run, for the 17 keys that are real gates
still owed a catalogue entry (`ontology_monitor.enabled`, `skills.codeact.enabled`,
`toolchains.claude`, `plugins.memory.enabled`, …). Laundering those into a
"not a capability" group would have been the easy way to a green build and is
forbidden.

## Consequences

- Adding a capability gate now forces a decision at review time: catalogue it, or
  say in writing why it is not a capability.
- The 17 named deficits are visible on every CI run instead of buried in 130 lines
  of noise. Closing them means editing `management-api/lib/system-manifest.js`,
  which this change deliberately does not touch — the deficit is named, not fixed.
- Cost: the baseline is 130 keys of explicit list, and a legitimate new sub-option
  under an already-catalogued parent now needs a one-line baseline addition. That
  friction is the point, and the ratchet keeps it from becoming a dumping ground.
- `.github/workflows/invariants.yml` already runs this check (step
  "check-manifest-catalogue (ADR-039 gate-path parity)"), so the tightening is live
  in CI with no workflow change.

## Verification

At `e070514d808b218574403377fb75e0e1a0a256b3` plus this change,
`node scripts/ci/check-manifest-catalogue.js` exits 0, printing the 17-key
capability-deficit warning and `PASS … all 60 catalogue gate paths resolve`.
Four failure modes were each provoked by a temporary mutation of the script and
reverted: removing one key from the baseline made it fail exit 1 with
`1 toml boolean key(s) with no catalogue entry` naming that key; adding a
non-existent key to the baseline failed with `stale BASELINE … no longer a boolean
key`; adding an already-catalogued key (`security.deepsec.enabled`) failed with
`now has a CATALOGUE entry`; a duplicated key failed with `listed twice`. The
restored script passes.
