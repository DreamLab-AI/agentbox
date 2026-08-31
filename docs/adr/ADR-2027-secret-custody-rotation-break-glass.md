---
id: ADR-2027
title: "Secret custody, rotation, and break-glass lifecycle"
date: 2026-08-31
decision_status: proposed
implementation_status: none
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit:
verified_paths: []
owner: jjohare
review_trigger: introduction or rotation of any load-bearing secret; compromise incident
repo: agentbox
domain: SECURITY-profiles
---

# ADR-2027 — Secret custody, rotation, and break-glass lifecycle

## Context

Panel finding P1-5: at least five load-bearing secrets are implied across the
estate and none has a recorded custodian, rotation cadence, or revocation path.
They are: the visionclaw bridge key (visionclaw ADR-2013); the "currently
shared" visionclaw-server publisher key, whose per-consumer split is explicitly
pending (agentbox ADR-2012); the break-glass bearer (agentbox ADR-2009/2010) —
the only credential surviving verifier failure and the least governed, i.e. an
ungoverned master; the dream-dispatch SSH credential to `john@10.10.10.1`
(agentbox ADR-2024); and `backup-secrets.sh` (visionclaw ADR-2017). The relay
allowlist in agentbox ADR-2012 is baked at nix build, so publisher revocation
needs a full rebuild — the compromise window is one build-deploy cycle.

## Decision

Each load-bearing secret MUST have a recorded custodian, storage location,
rotation cadence, and revocation path. Break-glass bearers MUST be short-lived,
single-scoped, and audit-logged on every use — no bearer functions as a standing
master credential. The shared visionclaw-server publisher key MUST be split per
consumer (the pending ADR-040 D3 split). Rotation of a build-baked allowlist
entry MUST be documented as requiring a full rebuild until the allowlist is moved
to runtime config, and that rebuild-bound compromise window is recorded against
the secret.

## Consequences

- The five implied secrets become governed: each gains an owner, a rotation
  cadence, and a revocation path, so a compromise has a bounded, documented
  response rather than an ad-hoc scramble.
- The break-glass path stops being an ungoverned master credential — short-lived,
  single-scoped, audit-logged use makes its exercise witnessed and its blast
  radius small.
- Cost/follow-on: the publisher key-split (ADR-040 D3) must land before the shared
  key is retired; until the ADR-2012 allowlist moves to runtime config, publisher
  revocation still costs a rebuild cycle, which this record makes explicit rather
  than removing.

## Verification

None yet — this record is `proposed`/`none`/`inactive`. Verification lands when
the custody register exists, the publisher key-split ships, and break-glass use is
audit-logged; at that point set `verified_commit` and populate `verified_paths`.
Governing surface: `docs/SECURITY-profiles.md`.
