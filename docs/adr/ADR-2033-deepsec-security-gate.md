---
id: ADR-2033
title: deepsec is the executed Security gate of build-with-quality, baked as a manifest-gated CLI under a names-only credential policy
date: 2026-09-05
decision_status: accepted
implementation_status: partial
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 7bf2382c031d696b0b2f5eb466f7e6615c88cc2c
verified_paths: [flake.nix, agentbox.toml, schema/agentbox.toml.schema.json, scripts/agentbox-config-validate.js, management-api/lib/system-manifest.js, skills/build-with-quality/scripts, skills/build-with-quality/references/deepsec-security-gate.md, .github/workflows/deepsec.yml]
owner: jjohare
review_trigger: a deepsec major version, a change to its CLI exit-code contract or model-route schema, any new model route, or the first paid full-repo run
repo: agentbox
domain: GOVERNANCE-capabilities
---

# ADR-2033 — deepsec is the executed Security gate of build-with-quality, baked as a manifest-gated CLI under a names-only credential policy

## Context

The build-with-quality skill declared a Security gate ("SAST/DAST scanning, zero
critical/high vulnerabilities") with no executor behind it, so the gate was a
narrated claim. vercel-labs/deepsec (Apache-2.0, npm `deepsec`) is an agent-driven
vulnerability reviewer with a documented PR mode (`process --diff`, exit 0 = no
net-new findings, 1 = findings) and a persisted, non-secret model route. Its
default onboarding (`deepsec init`) writes a `.deepsec/` workspace with its own
`node_modules`, links a Vercel project and can spend without a bound, none of which
fits an immutable, manifest-governed image (ADR-2020) or the names-only secret
posture (ADR-2027).

## Decision

1. deepsec is baked as a global npm CLI via `lib/npm-cli.nix` (`deepsecPkg`,
   exact pin 2.3.9) gated by `[toolchains].deepsec`; `ENABLE_DEEPSEC` is projected
   at boot and the catalogue entry `deepsec` (ADR-039) reports both gates.
2. Runtime policy lives in `[security.deepsec]` (agent, model route, thinking
   level, `fail_on` severity, `max_duration`, batching, provider names). The
   manifest stores env-var names only; the validator rejects values (E072) and
   enforces the route/toolchain pairings (E070, E071) and warns on a baked but
   ungated binary (W070).
3. The only in-container entry point is
   `skills/build-with-quality/scripts/deepsec-gate.sh`. It generates a minimal
   `.deepsec-gate/deepsec.config.mjs` (gitignored), never runs `deepsec init`,
   bounds runs with `max_duration`, applies `fail_on` over exported findings and
   writes `receipt.json` per run. Exit 78 (disabled/unavailable) must be recorded
   as SKIPPED, never as a pass.
4. The default route is `model_auth = "local"` (the logged-in `claude` CLI); the
   LAN-only alternative is `custom` through the Loom façade with the `pi` agent.
5. CI runs the same script in PR mode on same-repo PRs carrying the `deepsec`
   label, with the two-job no-write/comment split and full-SHA action pins.

## Consequences

- The Security gate is executed evidence with a receipt; EDD auditors re-run the
  same command on the same revision.
- A paid AI stage exists behind a label and a bound; `--scan-only` stays free.
- The image grows by the deepsec closure (Claude Agent SDK, Codex SDK, ink).
- The manifest TUI does not yet expose `toolchains.deepsec`; a TUI save in merged
  mode preserves the key verbatim, so exposure is deferred without data loss.

## Verification

Source at `89301ec7c911eab270c00a0cf81596d0d4f15535` plus this working tree: `node --test
skills/build-with-quality/scripts/deepsec-gate.test.mjs` (fake CLI: policy
resolution, exits 78/70/1/0, threshold, receipts, names-only config) passes;
`node scripts/agentbox-config-validate.js agentbox.toml` accepts the manifest
with the new block; `node scripts/ci/check-manifest-catalogue.js` resolves the
new gates; `bash skills/lint-skills.sh` accepts the skill changes. The tarball
sha256 was computed from the registry download on 2026-09-05; the
`nodeModulesHash` is the placeholder until the first `nix build .#runtime` on the
host prints it — implementation is therefore **partial** and activation
**staged** until that rebuild lands and a real `--diff` receipt exists.

**2026-09-05 re-verified at 08e817f39.** Governed paths changed by `7e7b2d586` (`.github/workflows/deepsec.yml` and the invariants wiring) and `08e817f39` (`flake.nix`). The decision still holds, and **one arm of the partial status has closed**: `deepsecPkg` at `flake.nix:444-448` (line numbers at HEAD `08e817f39`; the working tree carries other lanes' uncommitted edits that shift them) now carries a resolved `nodeModulesHash = "sha256-svwTvpVDYWCKfTnO4YL70f1qcDDiEQ0JLFpZfK36qIk="` rather than the placeholder the Verification paragraph above describes, together with `stripDevDeps = true` (`:460`) and the inline rationale at `:451-459` (deepsec 2.3.9's published tarball keeps `workspace:*` monorepo packages in `devDependencies`, which modern npm resolves before `--omit=dev` prunes, aborting the build; the shipped `dist/cli.mjs` is pre-bundled so they are never needed). Re-checked at HEAD: the exact 2.3.9 pin at `flake.nix:446` gated by `[toolchains].deepsec` at `:475`, `ENABLE_DEEPSEC` projected at `flake.nix:3517`, `agentbox.toml:1362` `deepsec = true`, the `[security.deepsec]` policy block from `:1615`, and the catalogue entry at `management-api/lib/system-manifest.js:91-93` reporting both gates with `apply_class: 'rebuild'`. Validator codes E070/E071/E072/W070 are implemented at `scripts/agentbox-config-validate.js:1225-1260`. The gate script documents exit `0/1/70/78/124` at `skills/build-with-quality/scripts/deepsec-gate.sh:22-23` with `EX_CONFIG=78` at `:27`, validates `fail_on` against the six-value set at `:111`, and writes `receipt.json` at `:232`. CI runs the same script in PR mode behind the `deepsec` label at `.github/workflows/deepsec.yml:32` and `:69`, with full-SHA action pins. Live runs: `node --test skills/build-with-quality/scripts/deepsec-gate.test.mjs` → **10 pass, 0 fail**; `node scripts/agentbox-config-validate.js agentbox.toml` → valid (5 advisory warnings, none deepsec); `node scripts/ci/check-manifest-catalogue.js` → `PASS … all 57 catalogue gate paths resolve`. `implementation_status` stays `partial` and `activation_status` `staged`: the hash is resolved but no host `nix build .#runtime` image digest was captured by this pass and no real `--diff` receipt exists, which is the remaining acceptance condition. Commands: `git diff --name-only 89301ec7..HEAD -- flake.nix agentbox.toml .github/workflows/deepsec.yml skills/build-with-quality/`, the three test/validator runs above.

## Closeout extension — 2026-09-05

CP-04/07/08. Owner remains jjohare with capability/runtime maintainers.
**Acceptance condition:** resolve `nodeModulesHash` on the host rebuild and
record the image digest; run `deepsec-gate.sh --diff` on a real change with the
local route and archive the receipt; run one `--full` pass with a cost bound and
compare the FP rate after `revalidate`; verify the CI job on a labelled PR with
the secret present and absent (SKIPPED path); decide whether the Loom `custom`
route is the estate default for private repositories. Reopen on the review
trigger above.

## Amendment — 2026-09-05 (schema declarations added, ADR-2039 sweep)

This record's manifest keys were added to `agentbox.toml` without the corresponding declarations in
`schema/agentbox.toml.schema.json`, whose `skills`/`toolchains`/`security` nodes are
`additionalProperties: false`. The tree therefore failed its own static gate:

    node scripts/agentbox-config-validate.js
    E016 UnknownManifestKey: unknown key "deepsec" at /toolchains
    E016 UnknownManifestKey: unknown key "deepsec" at /security

Both are now declared: `[toolchains].deepsec` as a boolean, and `[security.deepsec]` as an object
whose `agent`, `model_auth`, `thinking_level` and `fail_on` carry the enums this record's own comments
state, with `ai_api_key_env` documented as holding the NAME of an env var and never a credential.
`node scripts/agentbox-config-validate.js` now exits 0 with zero `E` diagnostics.

This is the failure mode ADR-2003's rule exists to prevent — adding a gate means gating the package
set, the supervisor block, the manifest schema and the `system-manifest.js` catalogue entry together.
A key that only exists on one side of that set is invisible to review and fails the build gate for
everyone. Verified on the uncommitted working tree above agentbox SHA
`89301ec7c911eab270c00a0cf81596d0d4f15535`.

## Landing re-verification — 2026-09-05 (ddd1f1ec8)

Governed paths changed in the landing commit: agentbox.toml, schema/agentbox.toml.schema.json, management-api/lib/system-manifest.js, flake.nix: the ADR-2057 podcast_ingest gate and catalogue entries; skills/build-with-quality/scripts/deepsec-gate.sh: dropped `--no-tui`, which the baked deepsec 2.3.9 rejects, so the gate now executes for real (SCANNED, 1153 candidates, exit 0) where before it exited 70 on every run; deepsec-gate.test.mjs: the fake CLI rejects unknown options and the missing-binary case no longer leaks the ambient PATH (10/10). The decision holds and is strengthened; status stays partial/staged pending a host image receipt. Decision unaffected; `verified_commit` moved to the landing commit.

## Landing re-verification — 2026-09-06 (796d85fcf)

Governed paths changed in the Wave 3 landing commit: agentbox.toml, flake.nix. The changes are the ones recorded by the Wave 3 records landed in that commit (ADR-2061, 2064, 2065, 2066, 2068, 2069, 2070, 2072, the proposed 2071/2073–2078) and the ADR-2018 recall diagnosis; none alters this record's decision. Gates at the landing commit: management-api 81 suites / 1290 tests, exposure gate PASS, catalogue 60 paths, config validation clean. `verified_commit` moved to the landing commit.


## Bounded source re-verification — 2026-09-07

The flake delta adds only secretBackupPkg; deepsec package gating,2.3.9 pin and supervisor/policy wiring are unchanged. No scan or paid provider activation is asserted. The complete intervening change to the governed source was reviewed at `a0ee1fe5740baa38e14c4ff3fe512dd557bcbb6e`; prior runtime/approval limitations remain.

### 2026-09-07 npm closure re-verification

The intervening governed `flake.nix` change adds exact package-lock inputs for
the nine existing npm CLIs and updates five dependency-output hashes after a
manifest-by-manifest comparison. No existing package version changed; additions
are optional musl packages already present in the original locks. All nine
fixed-output derivations passed an explicit HP `nix build --rebuild` replay.
This changes reproducible package installation, not the ADR's admission, custody
or publication rule. Source verification is renewed at this commit; existing
activation evidence and limits remain unchanged. The active local container was
not replaced, and no key was rotated.

### 2026-09-07 documentation and workflow pin re-verification

The governed manifest diff at `7bf2382c031d696b0b2f5eb466f7e6615c88cc2c`
adds only two comments distinguishing the consultant wire alias from the documented
weight variant. The invariants workflow replaces action version tags with exact
commit pins and retains the same checks. Neither diff changes this decision’s
runtime behaviour; existing implementation and activation qualifications remain.
