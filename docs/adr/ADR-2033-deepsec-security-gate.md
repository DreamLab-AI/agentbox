---
id: ADR-2033
title: deepsec is the executed Security gate of build-with-quality, baked as a manifest-gated CLI under a names-only credential policy
date: 2026-09-05
decision_status: accepted
implementation_status: partial
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 89301ec7c911eab270c00a0cf81596d0d4f15535
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
