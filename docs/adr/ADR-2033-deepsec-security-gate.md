---
id: ADR-2033
title: deepsec is the executed Security gate of build-with-quality, baked as a manifest-gated CLI under a names-only credential policy
date: 2026-09-05
decision_status: accepted
implementation_status: partial
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 541e96dcc2ede699b97f0e9699bc4c9c34f1ad17
verified_paths: [flake.nix, agentbox.toml, schema/agentbox.toml.schema.json, scripts/agentbox-config-validate.js, management-api/lib/system-manifest.js, skills/build-with-quality/scripts, skills/build-with-quality/references/deepsec-security-gate.md, .github/workflows/deepsec.yml]
owner: jjohare
review_trigger: a deepsec major version, a change to its CLI exit-code contract or model-route schema, any new model route, or the first paid full-repo run
repo: agentbox
domain: GOVERNANCE-capabilities
---

# ADR-2033 — deepsec is the executed Security gate of build-with-quality, baked as a manifest-gated CLI under a names-only credential policy

## Re-verification — 2026-10-02 at caab741c6 (factrail landing, ADR-2121)

The factrail landing (ADR-2121, `b7fc2b0e5` + `caab741c6`) touched governed paths without touching this decision: `agentbox.toml` changes only inside `[features.jev_compaction]` (comments, `min_reduction_ratio` removed, five new keys); `flake.nix` gains only the factrail package, its `/opt/agentbox/bin/factrail` link and the shim copy, each under `lib.optionalString jevCompactionOn`; `management-api/lib/system-manifest.js` changes only the `jev-compaction` catalogue entry (name, summary, `apply_class` boot → rebuild); `schema/agentbox.toml.schema.json` changes only inside the `jev_compaction` object; `scripts/agentbox-config-validate.js` changes only the W072 comment and message. No hunk falls in code this record governs, so its claims and status axes stand unchanged.

## Re-verification — 2026-10-01 (dependency refresh)

The pinned CLI moves to 2.3.10 with reviewed lock and resolved hashes. Runtime policy, names-only credentials and the sole gate entry point are unchanged. All 10 deepsec-gate fixture tests pass; this does not assert a paid provider scan.
Source anchor: `bce906199`. Existing status axes and deferred
work remain unchanged; this source/test receipt is not a new activation claim.

## Re-verification — 2026-09-29 (instruction-home migration)

Volume-identity correction at `efdb79475`: already-prefixed names are retained by the generator. The new resolved-Compose test passes for 15 persistent volume identities, the external Claude home, read-only instructions and PID parity. This changes no service authorization or published ports.

Packaging follow-up at `fc8ba7a7b`: the config copy now filters out mount-only instruction layers. Rechecked the changed Nix expression; it does not alter this record's runtime gates, auth commands or port inventory. The local test evidence below remains applicable.

Re-read the deepsecPkg/toolchain gate and catalogue entry: the new instruction and credential entries do not alter the names-only policy or execution gate. All ten fake-CLI deepsec-gate tests pass; no paid security scan was run. Verification anchor: `526b97dc6`. Status axes are unchanged by this source check.

## Context

## Re-verification — 2026-09-30 (interim sidechain supervision)

The Nix, manifest and schema changes are sidechain-only. Deepsec policy and package pin are unchanged; all 10 deepsec-gate tests pass. Catalogue parent-gate handling preserves existing entries.
Source anchor: `d0fa1b80b`. Existing status axes and deferred work are unchanged;
this scoped source/test receipt does not assert a new running-image activation.

### Original context

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
   exact pin 2.3.10) gated by `[toolchains].deepsec`; `ENABLE_DEEPSEC` is projected
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
fixed-output derivations passed an explicit the connected node `nix build --rebuild` replay.
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

### 2026-09-07 development-shell re-verification

The only intervening governed flake change selects the upstream executable
`nix2container.packages.${system}.nix2container-bin` for devShell buildInputs;
the former `n2c.nix2container` attribute does not exist. The selected executable
derivation evaluates on the pinned the connected node input. Container package selection,
admission and custody behaviour are unchanged by this development-shell repair.
Existing runtime activation limits remain. Verification is renewed at
`8fcc7b79b7c93c0744ca68b7a09fa14fdae8f5e3`; the project flake.lock has not been updated.

**2026-09-07 re-verified at `ee742ade5`.** Governed paths changed by `ee742ade5` (ADR-2082 orchestration proxy): agentbox.toml management-api/lib/system-manifest.js schema/agentbox.toml.schema.json. The changes are additive — two new `[integrations.ruvector_external]` keys, their entrypoint env projection, one catalogue entry and two schema properties — and touch none of the sections this record governs; the decision and its invariant hold unchanged. Re-verified by `git diff 8fcc7b79b..ee742ade5 -- <verified_paths>`; no re-implementation was needed.

## Re-verification — 2026-09-21 (`b680a7aeef604276af73e00e1eb5156f379530ae`)

Tripped by six of its eight governed paths, all moving for unrelated reasons (feature blocks, the Loom generalisation, new validator rules). Every numbered point re-established at `HEAD`: (1) `deepsecPkg` pinned to 2.3.9 via `mkNpmCli` (`flake.nix:480-500`) behind `[toolchains].deepsec = true` (`agentbox.toml:1630`), catalogue entry `deepsec` naming both gates with `apply_class: rebuild` (`management-api/lib/system-manifest.js:91-93`); (2) `[security.deepsec]` policy block intact with env-var *names* only (`agentbox.toml:1887-1899`), and E070/E071/E072/W070 all present (`scripts/agentbox-config-validate.js:1225-1258`); (3) `skills/build-with-quality/scripts/deepsec-gate.sh` is the sole entry point, documents `78 gate unavailable or misconfigured`, sets `EX_CONFIG=78`, instructs "record the gate as SKIPPED, not passed" and generates its own `deepsec.config.mjs` without `deepsec init`; (4) `model_auth = "local"`, `agent = "claude"`; (5) `.github/workflows/deepsec.yml` present. `node scripts/agentbox-config-validate.js agentbox.toml` → valid, no E070/E071. Claim STILL TRUE.

## Re-verification — 2026-09-21 (`e57156a8ff72a4b84145b7de1d67d8d0c79fd41d`)

Tripped by four of the eight governed paths (`b680a7ae`, ADR-2094): `agentbox.toml`, `management-api/lib/system-manifest.js`, `schema/agentbox.toml.schema.json`, `scripts/agentbox-config-validate.js`. `flake.nix`, the two `skills/build-with-quality/**` paths and `.github/workflows/deepsec.yml` are unchanged, so decision points 1, 3 and 5 rest on untouched files.

The four that moved were all extended for a new gate, not edited for this one, and each of this record's surfaces was re-read at HEAD in a detached worktree rather than inferred from the diff shape:

- **Point 2, runtime policy and its validator rules.** `scripts/agentbox-config-validate.js:1225` still opens the `E070-E072 / W070` block for `[security.deepsec]`; E070 (enabled requires `[toolchains].deepsec`), E071 (`model_auth="local"` + `agent="claude"` requires `[toolchains].claude_code`), E072 (env-var NAME, not a value) and W070 (baked but ungated) are all present and unmodified. ADR-2094 appended `E075`/`W073` for a different gate; the codes do not collide and the deepsec block is not in their path.
- **Point 1, the catalogue entry.** `management-api/lib/system-manifest.js:91` still carries `{ id: 'deepsec', … }`; the ADR-2094 entry was inserted elsewhere in the array.
- **Schema.** The `deepsec` blocks are still present in `schema/agentbox.toml.schema.json`; the SSO properties were added under `features`, a sibling.
- **Point 4, the default route.** `[security.deepsec]` in `agentbox.toml` is untouched by the diff; `model_auth = "local"` stands, and the LAN-only `custom` alternative through the Loom façade is unaffected — ADR-2094's façade is a typed-decision endpoint, not a deepsec model route, and does not re-point one.

`node scripts/agentbox-config-validate.js agentbox.toml` → `agentbox manifest valid: agentbox.toml (5 advisory warnings)`, none of them deepsec's and none new. Claim STILL TRUE.

### Re-verified 2026-09-21 at 5763f1014682c4a69175cd2e30528c6a46f80850

Two governed paths moved for reasons outside this claim. `management-api/lib/system-manifest.js` changed in two places, both about the ADR-2091 skill router: its catalogue gate moved from the section `skills.routing` (which has no `enabled` key, so it resolved to undefined and failed the ADR-039 parity gate) to the mode string `skills.routing.router`, and `stateOf` learned per-entry `off_values` so `router = "table"` reads as off. The `deepsec` catalogue entry, its `security.deepsec` gate and its apply class are byte-identical. `flake.nix` moved only in the mcp-hub supervisor block (ADR-2104); `git diff e57156a8f..HEAD -- flake.nix | grep -i deepsec` is empty, so the baked CLI, its manifest gate and the names-only credential policy are untouched. Re-established at HEAD: `node scripts/ci/check-manifest-catalogue.js` PASSes all 65 gate paths, the composed view reports `deepsec: on`, and `node --test skills/build-with-quality/scripts/deepsec-gate.test.mjs` is green. Claim STILL TRUE.

**2026-09-21 re-verified at `ab785f08c`.** Governed paths changed by the ADR-2105 kind move: agentbox.toml. The change is a kind-number relocation (colloquy 38100-38105 to 38410-38415, settlement 38110-38115 to 38420-38425) plus six numbers appended to `[sovereign_mesh.relay].allowed_kinds` and a comment above it; it touches no section this record governs. The decision and its invariant hold unchanged. Re-verified by `git diff 5763f1014..224afae65 -- <verified_paths>`; no re-implementation was needed.

## Re-verification — 2026-09-22 at d6b976271 (Sovereign Corpus landing)

**Governed changes:** `agentbox.toml`: `[vault]` gains the optional `repo` key (the vault repository root, exported as `VAULT_REPO`); `format` comments now state `obsidian` is the only value; one comment reworded ("logseq corpus" → "vault corpus"). `flake.nix`: statix lint only — assignment→`inherit` (with `or` defaults preserved as `inherit ({ defaults } // cfg)`), redundant parentheses dropped, `(x or false) == true` rewritten as `let v = x or false; in builtins.isBool v && v` (same result for every input), and one comment reworded ("logseq corpus" → "vault corpus"). No derivation, port, service, gate or package changed. `schema/agentbox.toml.schema.json`: `vault.repo` declared (string, optional); `vault.format` enum narrowed to `obsidian` ("logseq-legacy" was read by nothing); one description reworded. **Decision unaffected** — none of these touches what this record decides. `verified_commit` moved to the landing commit. Gates at that commit: routing table current; forum e2e real mode 101/101 and stub 30/30 against this tree; management-api jest 88/88.

## Re-verification — 2026-09-26 at 6ea592ee0 (ADR-2111/2116 landing)

**Governed changes, none to the decision:** `flake.nix` rehashed the deepsec `nodeModulesHash` (`7f5a224e4`) with the exact pin `2.3.9`, `packageLock` and tarball `sha256` unchanged; the other flake, `agentbox.toml`, schema, validator and catalogue hunks belong to other records (tmpfs, Transformers, jupyter tests, `[claude_code]`, jev-compaction keys, routing cascade/labels: schema blocks, E076, E077, W074, three catalogue entries; plus a `—` re-escaping of existing schema descriptions, including `[security.deepsec]`'s, with identical decoded text). E070/E071/E072/W070 remain in `scripts/agentbox-config-validate.js`; `node scripts/agentbox-config-validate.js agentbox.toml` → valid (5 unrelated advisories); `check-manifest-catalogue.js` → PASS (69). `deepsec-gate.sh`, its reference and the workflow did not move. Claim STILL TRUE.

## Re-verification — 2026-10-02 (`a48ea407a24185f7a4f654a35e66805778acbec8`)

Tripped by ADR-2078 (pods signer signs as the sovereign identity). `agentbox.toml` changes only in `[integrations.solid_pod_rs]`: `sign_requests` false→true and the comment block above it (ADR-2078). It touches no section, key or phase this record governs, and the decision holds unchanged.
Re-verified by `git diff c7b5d5f55..a48ea407a -- <verified_paths>`; no re-implementation was needed.

## Re-verification — 2026-10-02 (`f7465412de3d0d7a25fc1b6b2c8a72775490616d`)

Tripped by the `sidestr:dreamlab-txbt4` seal. `agentbox.toml` adds the `[sidechain.dreamlab-txbt4]` table, with `enabled = false`. No other key changed. `flake.nix` adds `sidechainChains`, one entry per `[sidechain.<name>]` table. For each table enabled under an enabled `[sidechain]` it bakes three supervisor programs, `sidestr-{producer,mirror,faucet}-<name>`: user devuser, the existing `config/sidechain` runners, and a producer the engine binds to 127.0.0.1:3451. `sidestr-agent` is baked when any faucet is on. The one table shipped is `enabled = false`, so the rendered supervisor text is unchanged. No port, Compose service, volume, user, MCP registration or other program moved. `management-api/lib/system-manifest.js` adds the `sidechain-dreamlab-txbt4` catalogue entry. `stateOf` gains an optional `requires` list: every gate listed must be true, or the module is off. Entries without `requires` resolve as before. `schema/agentbox.toml.schema.json` adds the `dreamlab-txbt4` object under `sidechain`. No other property changed. No deepsec gate, program, catalogue entry or schema property changed. **Decision unaffected.** `verified_commit` moves to the seal commit. Gates at that commit:

- the manifest validator is valid;
- `check-manifest-catalogue` passes;
- `tests/config/sidechain-genesis.test.sh` passes 7/7 and `sidechain-producer-gates.test.sh` 7/7.

## Re-verification — 2026-10-02 (`6db0ffc8df1e708047c210353f730d1f0427553d`)

Tripped by ADR-2097 (the sidestr payment rail). `agentbox.toml` gains one new table, `[payments.sidestr]` (ADR-2097), placed after `[skills.payment_router]`; no existing key, value or line above it moves; `schema/agentbox.toml.schema.json` gains `payments.properties.sidestr` only; `scripts/agentbox-config-validate.js` gains the E-PAY5/E-PAY6 block for that table and one header line; no existing rule changes. Nothing this record governs is touched, and the decision holds unchanged.
Re-verified by `git diff f7465412d..6db0ffc8d -- <verified_paths>`; no re-implementation was needed.

## Re-verification — 2026-10-02 (`9b02329673e6f44eb721210b5dbf40c87be33cd6`)

Tripped by the ADR-2097 catalogue fix. `management-api/lib/system-manifest.js` gains one CATALOGUE entry, `payments-sidestr` (gate `payments.sidestr.enabled`, apply class boot). No existing entry, including deepsec's, changes, and the decision holds unchanged.
Re-verified by `git diff 6db0ffc8d..9b0232967 -- <verified_paths>`; no re-implementation was needed.

## Re-verification — 2026-10-02 (`e434a7a596a3a0518c51b7da107d6e0831891910`)

Tripped by the sidechain health and witness change. `agentbox.toml` changed only in `[voice]`: `enabled` false → true, with a comment, so that the descriptive sidecar state matches the four running agentbox-voice containers (CY-A2, `scripts/ci/check-declared-vs-running.js`). No other key moved. `management-api/lib/system-manifest.js` changes in three places. `buildSystemView` gains an optional per-module `health` input and a top-level `health` block. The sidechain summary describes the tip-age probe. The sovereign-mesh entry's `service` is corrected to its supervisor program, `nostr-relay`. The deepsec catalogue entry and `[security.deepsec]` are unchanged. The deepsec-gate unit tests pass 10/10, and `check-manifest-catalogue` passes. Decision and status unchanged.

## Re-verification — 2026-10-02 (`e020264b54c6872ca98995c1adda18b8451a39af`)

Tripped by ADR-2097 (the rail keyed by chain). `agentbox.toml` changes only inside `[payments.sidestr]` (ADR-2097): its comment block, `chain_id` now `sidestr:dreamlab-txbt4`, and `producer_url` dropped in favour of the chain's derived port; `schema/agentbox.toml.schema.json` changes only `payments.properties.sidestr` (`producer_url` optional, `mirror_url` added). Nothing else this record governs is touched, and the decision holds unchanged.
Re-verified by `git diff e434a7a59..e020264b54c6872ca98995c1adda18b8451a39af -- <verified_paths>`; no re-implementation was needed.

## Re-verification — 2026-10-03 (`055c06ff69b2f53bf38a67d254c048bb03599fc8`)

Tripped by custody X-1 step 1 (W0 `custody/w0-bypasses` and W1 `custody/w1-role-accounts`). `flake.nix` changed only as follows. W0 (`8070c1010`, `6a433e6b3`): `root` loses its `devuser` member, and `[program:docker-read-proxy]` is added (root start, drops to 65534). W1 (`b8c66625a`, `055c06ff6`): role passwd and group lines are appended from `config/role-accounts.json`, `supervisord.roles.conf`, `role-secrets.tsv` and `role-accounts.json` are derived beside the unchanged `supervisord.conf`, and a root-owned `/run/secrets` tmpfs is added (ADR-2122). `agentbox.toml` gains only `[security].role_isolation = false` with its comment (ADR-2122); no other key moved. The schema gains `security.role_isolation` beside `security.deepsec`, and the catalogue gains a sibling `role-isolation` entry. The deepsec package, policy and catalogue row are unchanged. `check-manifest-catalogue` passes. The decision holds.
Re-verified by `git diff 0919dc39a..055c06ff6 -- <verified_paths>`. No re-implementation was needed. The image is unverified until the owner's rebuild.

## Re-verification — 2026-10-03 (`d3ff8e9a876e6b026b543f8824487e002e04cfa0`)

Tripped by the G-5 Q15 correction (`custody/w8-key-split`). `agentbox.toml` changed only in the trailing comments of two allowlist entries: `b41654017f…2f7a` is relabelled as the operator's NIP-07 31403 decision signer (it is `[sovereign_mesh.operator].pubkey_hex`), not visionclaw-server, and the `11ed6422…663c` entry in `[interaction_plane.proxy]` notes that its Podkey-vault copy is to be replaced by K_browser. No key, value, table or list member moved. `node scripts/agentbox-config-validate.js agentbox.toml` is valid with the same 5 advisory warnings as `origin/main` (`0919dc39a`). Decision and status unchanged.

## Re-verification — 2026-10-03 (`275e12356319a9630846656580d497d53de3d38c`)

Tripped by custody X-1 step 1, W2 (`custody/w2-env-scrub`: `0965a9c8c`, `042115499`, `275e12356`; bypass 3, ROLE secrets out of PID 1's environment). `flake.nix` changes only `[program:tailscale-up]` (a `TAILSCALE_AUTHKEY_FILE` branch that passes `--authkey=file:<path>`; the original branch is unchanged and is the one taken with the flag off) and the `[program:nostr-gateway]` comment. The decision holds.
Re-verified by `git diff 055c06ff6..275e12356 -- <verified_paths>`. No re-implementation was needed. The image is unverified until the owner's rebuild.

## Re-verification — 2026-10-03 (`3b54129631067277f6363309b01cce485faa027a`, custody integration head)

Tripped by the custody integration (`custody/integration`: W0, W1, W5, W3, W7a, W8, W2, W9 and
the integration resolutions, ADR-2122). Since `275e12356` the governed paths changed as follows. `agentbox.toml` changed only in the trailing comments of two allowlist entries (`d3ff8e9a8`, the Q15 correction: `b4165401` is the operator's decision signer). `flake.nix` gains three things: W5's read-only bake of the sidestr upstream (`lib/sidestr-upstream.nix`, linked at `/opt/agentbox/sidestr/upstream` under `[sidechain].enabled`; `e103f81a7`); the isolated supervisor config renamed `/etc/supervisord.roles.conf` (`760ed01e4`); and a `[program:serve-identity]` block that prints one line and exits 0 while `[security].role_isolation` is off (`b49c62249`). `management-api/lib/system-manifest.js` changes two summary strings only (the producer runs the baked upstream; the roles config's name).
deepsec stays baked and manifest-gated, and its credential handling is unchanged. The decision holds. Re-verified by `git log 275e12356..3b5412963 -- <verified_paths>`
and the integration gates. Nix was not evaluated in this container; the image is unverified
until the owner's rebuild.

## Re-verification — 2026-10-03 (`32cedf9925ff6de8112fb45e41de048106d0d710`, custody integration CI fix)

Tripped by `32cedf992`, the fix for the PR's clippy and statix failures. `flake.nix` changes by one line in the `[sidechain.*]` normaliser: `parent = c.parent;` becomes `inherit (c) parent;` (statix W04), which evaluates to the same attribute set. Nothing this record governs changes meaning. The decision holds. Re-verified by `git log 3b5412963..32cedf992 -- <verified_paths>`.

## Re-verification — 2026-10-03 (`dc91e092ab646b4a825805b8229602ac8b15bad3`, custody W10)

Tripped by the W10 gap fixes on `custody/integration`. `flake.nix` (`dc91e092a`) gains one let-binding, `roleIsolationBaked = securityCfg.role_isolation or false`, and its inline `/etc/sudoers` lines become a call to `config/bake-devuser-privilege.sh` with that flag; with the flag off (the shipped value) the baked `/etc/group`, `/etc/sudoers` and `/etc/sudoers.d/devuser` are byte-identical (RC-X1-07). Nothing this record governs changes meaning. The decision holds. Re-verified by `git log 32cedf992..dc91e092a -- <verified_paths>`. Nix was not evaluated in this container.

## Re-verification — 2026-10-03 (`f93586b9e52fda0d0b367881e2d2ff3014509faf`, custody W2b/W4)

Tripped by `f93586b9e` (custody W2b and W4: the at-rest migrate/revert and the sidechain state move). `agentbox.toml` changes only in the comment above `[security].role_isolation = false`: it no longer says the identity port and the custody migration are absent, and names what is built (W3, W2b, W4) and what is owed (W3b). No key or value moves. The deepsec gate and its credential policy are untouched. The decision holds. Re-verified by `git log dc91e092a..f93586b9e -- <verified_paths>`.

### Re-verification — 2026-10-03 (vaultSrc repin)

`f93586b9e..33cbb29e8` changes one governed line: `flake.nix` `vaultSrc` moves from VisionClaw `64512141b` to main `94dc0ff60` (`33cbb29e8`, PR #13; ADR-2108 records why). Its one consumer is `lib/vault.nix` (the vault CLI package, `flake.nix:781`); nothing this record governs (ADR-2033 — deepsec is the executed Security gate of build-with-quality, baked as a manifest-gated CLI under a names-only credential policy) reads it. The decision holds. Re-verified by `git log f93586b9e..33cbb29e8 -- <verified_paths>`.

### Re-verification — 2026-10-03 (poker house seat, PR #14)

`33cbb29e8..b41d9486c`: `agentbox.toml` gains `[poker_citizen]` (`enabled = true`, key and state under `sidestr/agents`, the forum relay, `daily_cap = 20000`) (`55b9fe9f6`); `flake.nix` bakes `nostr-bbs-poker-citizen` (`lib/poker-citizen.nix`) and a `[program:poker-citizen]` (`user=devuser`) only when `[sidechain].enabled` and `[poker_citizen].enabled`; it opens no listener: it dials the forum relay over `wss` and the local producer at `127.0.0.1:3450` (`55b9fe9f6`); the CATALOGUE gains `poker_citizen.enabled` (`apply_class: rebuild`) (`b41d9486c`); the schema declares the closed `[poker_citizen]` object (`b41d9486c`). Nothing this record governs (ADR-2033 — deepsec is the executed Security gate of build-with-quality, baked as a manifest-gated CLI under a names-only credential policy) reads the new table or program. The decision holds. Re-verified by `git log 33cbb29e8..b41d9486c -- <verified_paths>`.

### Re-verification — 2026-10-03 (ab-poker-citizen role)

`b41d9486c..4ea3181b5` changes one governed line: `agentbox.toml` `[poker_citizen].state` becomes a comment (the runner's default is the same path flag-off), for the poker seat's role (`4ea3181b5`). Nothing this record governs (ADR-2033 — deepsec is the executed Security gate of build-with-quality, baked as a manifest-gated CLI under a names-only credential policy) reads that key. The decision holds. Re-verified by `git log b41d9486c..4ea3181b5 -- <verified_paths>`.

### Re-verification — 2026-10-03 (key-variable rule)

`4ea3181b5..e3b06d688` changes one governed line: `flake.nix` passes `--env-classes ${./config/custody/env-classes.json}` to the build-time `role-accounts isolate`, which now refuses a devuser program holding a key variable without a role (ADR-2122). Nothing this record governs (ADR-2033 — deepsec is the executed Security gate of build-with-quality, baked as a manifest-gated CLI under a names-only credential policy) changes. The decision holds. Re-verified by `git log 4ea3181b5..e3b06d688 -- <verified_paths>`.

### Re-verification — 2026-10-03 (ruflo 3.51.1, Claude Code 2.1.288)

`e3b06d688..dc6c7c5d8`: `flake.nix` changes only the `rufloPkg` pin: version 3.51.1, its lock (`config/npm-locks/ruflo-3.51.1.package-lock.json`) and both hashes (`dc6c7c5d8`), with the rationale comment. The ruflo closure's bins and extraBins aliases, every gate and every other derivation are unchanged. Nothing this record governs (ADR-2033 — deepsec is the executed Security gate of build-with-quality, baked as a manifest-gated CLI under a names-only credential policy) changes meaning. The decision holds. Re-verified by `git log e3b06d688..dc6c7c5d8 -- <verified_paths>`. Nix was not evaluated here; the image is unverified until the host rebuild.

### Re-verification — 2026-10-03 (agentic-qe 3.14.7)

`dc6c7c5d8..541e96dcc`: `flake.nix` changes only the `agenticQePkg` pin: version 3.14.7, its lock and both hashes (`541e96dcc`), with the rationale comment. Nothing this record governs (ADR-2033 — deepsec is the executed Security gate of build-with-quality, baked as a manifest-gated CLI under a names-only credential policy) changes meaning. The decision holds. Re-verified by `git log dc6c7c5d8..541e96dcc -- <verified_paths>`. Nix was not evaluated here; the image is unverified until the host rebuild.
