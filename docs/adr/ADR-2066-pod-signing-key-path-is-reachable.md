---
id: ADR-2066
title: The pod signing key path must be reachable — retire /workspace/profiles in loadSigner
date: 2026-09-05
decision_status: accepted
implementation_status: partial
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit: f475e0b8ee370610132d1920f1e64a82f83311ce
verified_paths: [mcp/servers/nostr-bridge.js, scripts/agentbox-config-validate.js, tests/config/semantic-rules.test.js]
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
- `scripts/agentbox-config-validate.js` hard-coded `/workspace/profiles` in its E010 profile scan. Fixed
  2026-10-31 (see the close-out): it now reads `$WORKSPACE/profiles`, falling back to
  `/home/devuser/workspace/profiles`, the same rule as `loadSigner`.

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

## Note — 2026-10-03: the devuser key path under `[security].role_isolation` (ADR-2122)

With the flag on, the devuser-readable copies of the sovereign key that a pod signer in
management-api could reach are removed from devuser's view:

- the boot no longer writes `/run/secrets/nostr.key` (devuser `0400`);
- `AGENTBOX_PRIVKEY_HEX`, `AGENTBOX_NSEC` and `AGENTBOX_BRIDGE_SK` are written to
  `/run/secrets/ab-identity/` (`0400`, uid 960) and then unset from PID 1's environment;
- `/run/secrets` itself is root-owned `0711` on its own tmpfs.

The fallback `$WORKSPACE/profiles/<stack>/nostr.key.enc` path that this record repaired is
**not** removed by W1. It goes when the pods signer moves to the identity port (custody W3b;
ADR-2078 amended). Once that lands, this record is superseded by ADR-2122 for "where the pod
signer gets its key". `superseded_by` is not set while ADR-2122 is `proposed`. With the flag off
nothing here changes. Status fields are unchanged: this note records a dependency and is not a
re-verification of this record's paths.

## Close-out 2026-10-31 (in-scope half only)

**Closed:** the validator's retired `/workspace/profiles`. `scripts/agentbox-config-validate.js` now derives the E010 profiles root from `$WORKSPACE` (fallback `/home/devuser/workspace`). The stale `/workspace/profiles` JSDoc in `mcp/servers/nostr-bridge.js` is corrected. `grep -rn "/workspace/profiles" scripts mcp` returns nothing.

**Tests:** `tests/config/semantic-rules.test.js` E010 block drives the validator as a subprocess with `WORKSPACE` pointed at a temporary tree: no profiles directory -> no E010; a `headless_only = true` profile with `desktop.enabled` -> E010 and a non-zero exit; a `headless_only = false` profile -> no E010. The old test could not fire E010 at all on a machine without `/workspace`. Run: `management-api/node_modules/.bin/jest --rootDir . --roots=./tests/config --testMatch '**/semantic-rules.test.js'` -> 80 passed, 1 skipped.

**Deliberately left open:** per-stack `nostr.key.enc` + `nostr.salt` provisioning and naming a signing stack. It is tied to owner-parked ADR-2078 (the pods signer moves to the identity port) and is not touched. `implementation_status` stays `partial` and `activation_status` stays `inactive`.

Re-verified 2026-10-31 at `2f15c531b02b8f8393d68d29ce3491712bdd862c` (W7 and W8 integration, `adr-sprint/w78`). Governed-path delta since `1e41b64b6`: `scripts/agentbox-config-validate.js` and `tests/config/semantic-rules.test.js`: additions only for E083 (brackets) and E082 (floats) and their tests; the E010 `$WORKSPACE` profiles-root code this record's close-out rests on is not touched. Read from the diff and checked against the merged tree's gates (cargo, jest, validator); nothing it changes is a key, table or code path this record decides, so the decision and status axes are unchanged. Re-run: `git diff 1e41b64b6..2f15c531b -- scripts/agentbox-config-validate.js tests/config/semantic-rules.test.js`.

## Scoped source re-verification — 2026-11-03

Verified source commit `c1b0c700c42596d35a1faba3074b667c1928d8fb`.

The sole governed delta is the W070 Deepsec warning text in agentbox-config-validate.js, replacing build-with-quality with VisionCraft. loadSigner, profiles roots, signing configuration and semantic-rule tests are unchanged. Manifest validation passes. This does not claim new key provisioning or pod-signing activation.

Re-verified 2026-11-11 at `237178730` (ADR-2192, ADR-2193, ADR-2194 at `04638a618`; ADR-2195 at this commit). Governed-path delta since `c1b0c700c`: `scripts/agentbox-config-validate.js` gains one block, E084, rejecting a `[skills.routing].scope` outside `registered` and `all`. The changes add a routing scope setting, a launcher for PID 1, one Rust skill tool and a gated-off CAD feature. They add no published port, mount, volume, secret, identity, model route, vault path, registry entry or Nostr kind, and alter no existing gate, so what this record decides is not touched. Run on this commit in the container: the configuration jest suites (294 passed), `skill-lint`, `skill-count-check`, the manifest validator, the egress register check, the secret inventory, the crate licensing check, the role-isolation and runtime-contract shell tests, `python-runtime-path` and `cad-launcher`. The flake was NOT evaluated (no Nix in the container) and no image has been built from it. The decision and status axes are unchanged. Re-run: `git diff c1b0c700c..237178730 -- <verified_paths>`.

Re-verified 2026-11-11 at `0ed05167b` (ADR-2196, removal of the dead `skills.browser.playwright` switch). Governed-path delta since `237178730`: `scripts/agentbox-config-validate.js` removes `playwright` from its exception feature map and known gates; `tests/config/semantic-rules.test.js` uses `code-server` and `gaussian-splatting` where it used the playwright exception. No published port, mount, secret, identity, route, vault path or registry entry changes, so what this record decides is not touched. Run on this commit: the manifest validator, manifest catalogue, configuration jest (301), agentbox-manifest cargo tests (235), skill lint (124). The flake edits are two whole-line deletions, not evaluated. The decision and status axes are unchanged.

Re-verified 2026-11-11 at `f475e0b8e` (ADR-2196, removal of the dead `skills.browser.qe_browser` switch). Governed-path delta since `0ed05167b`: `tests/config/semantic-rules.test.js` fixtures use `agent_browser` in its place. No published port, mount, secret, identity, route, vault path or registry entry changes, so what this record decides is not touched. Run on this commit: the manifest validator (live and default manifests), manifest catalogue, configuration jest (301), the TUI non-interactive validation (5), agentbox-manifest cargo tests (235). The flake edit is one whole-line deletion, not evaluated. The decision and status axes are unchanged.
