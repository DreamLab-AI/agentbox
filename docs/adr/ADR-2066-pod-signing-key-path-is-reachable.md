---
id: ADR-2066
title: The pod signing key path must be reachable — retire /workspace/profiles in loadSigner
date: 2026-09-05
decision_status: accepted
implementation_status: partial
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit: e070514d808b218574403377fb75e0e1a0a256b3
verified_paths: []
owner: jjohare
review_trigger: provisioning per-stack nostr key material, changing the profiles root or `$WORKSPACE`, or any new consumer of `loadSigner`
repo: agentbox
domain: INGRESS-identity
lineage: ADR-2064 (pod signing fails closed — this is its activation prerequisite), ADR-2027 (secret custody and rotation), PRD-014 Seam C/C2
---

# ADR-2066 — The pod signing key path must be reachable — retire /workspace/profiles in loadSigner

## Context

ADR-2064 makes pod request signing fail closed. That turns any unreachable
signer into a hard failure, so the reachability of the signing key stops being
cosmetic. Auditing it found pod NIP-98 signing could never have worked in this
image, for three independent reasons:

1. `loadSigner` in `mcp/servers/nostr-bridge.js` defaulted `profilesRoot` to the
   literal `/workspace/profiles`. That path is **retired** — `/workspace` does
   not exist in the container (`$WORKSPACE` is `/home/devuser/workspace`) — and
   no caller overrides it, so every production call could only `ENOENT`.
2. The supervised management-api process (pid 385) exports neither
   `AGENTBOX_STACK` nor `AGENTBOX_PROFILE`, and the manifest sets no
   `sign_stack`, so `buildPodNip98` returns `null` before reaching the loader.
3. No `nostr.key.enc` exists anywhere under `$WORKSPACE` or `/var/lib`.

Meanwhile `[integrations.solid_pod_rs].sign_requests = true`. The manifest
claimed signing that the runtime could not perform, and the old fail-open path
hid it.

## Decision

The signing key path is derived from the live workspace, never from the retired
literal.

- `loadSigner` defaults `profilesRoot` to `$WORKSPACE/profiles`, falling back to
  `/home/devuser/workspace/profiles`. The `opts.profilesRoot` test override is
  unchanged.
- Reasons 2 and 3 are **operational provisioning, not code**, and are recorded
  here rather than fixed: activating ADR-2064 in this deployment requires a
  stack that actually holds `nostr.key.enc` + `nostr.salt`, named by
  `AGENTBOX_STACK` or `[integrations.solid_pod_rs].sign_stack`. Until that
  exists, the honest manifest setting is `sign_requests = false` — declaring the
  pod path unsigned deliberately — rather than claiming signing the runtime
  cannot honour. The manifest now carries this prerequisite next to the key.

## Consequences

- `implementation_status: partial` and `activation_status: inactive` are
  deliberate: the code defect is fixed, the provisioning gap is not, and no ADR
  should claim otherwise.
- ADR-2064 stays `staged` until this ADR's prerequisite is met. The two are a
  pair: the fail-closed switch is only safe to leave on once the signer is
  reachable.
- `scripts/agentbox-config-validate.js` also hard-codes `/workspace/profiles`
  (lines 310-317). It is a validator that guards the read with `existsSync`, so
  it degrades to "no profiles found" rather than failing; left untouched here to
  keep this change to the signing path, and flagged for a follow-up sweep of the
  retired literal.

## Verification

Verified on the uncommitted working tree above
`e070514d808b218574403377fb75e0e1a0a256b3` (`git rev-parse HEAD`); the changes
described here were not committed at verification time, so `verified_paths` is
empty.

- Retired path confirmed dead: `ls -d /workspace` → `No such file or directory`;
  `echo $WORKSPACE` → `/home/devuser/workspace`, which holds 14 stack
  directories under `profiles/`.
- No caller overrides the default:
  `grep -rn "profilesRoot" management-api/ mcp/ config/ scripts/` returns only
  the definition itself and the unrelated validator.
- Missing stack confirmed from the live process:
  `tr '\0' '\n' < /proc/385/environ | grep AGENTBOX_STACK` → no match.
- No key material: `find /home/devuser/workspace /var/lib -name nostr.key.enc`
  → no results.
- `cd management-api && ./node_modules/.bin/jest` → 80 suites, 1289 passed,
  0 failed, including `tests/sovereign/pod-signer.test.js` and
  `tests/sovereign/elevation-publisher.test.js`, which exercise `loadSigner`
  through the `profilesRoot` override and are unaffected by the default change.
