---
id: ADR-2137
title: Generate image-scoped SBOM and VEX from shipped Nix payloads
date: 2026-10-11
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: f475e0b8ee370610132d1920f1e64a82f83311ce
verified_paths: [flake.nix, lib/sbomnix.nix, lib/sbomnix-python.nix, lib/agentbox-vex.nix, lib/vex-evidence.nix, services/agentbox-vex, scripts/security-scan.sh, scripts/runtime-delivery.cjs, agentbox.sh, tests/security, tests/config/runtime-delivery.test.cjs, .github/workflows/build-multi-arch.yml, .github/workflows/image-scan.yml, .github/workflows/release.yml, .github/workflows/security-vex.yml, .github/workflows/flake-check.yml]
owner: jjohare
review_trigger: image inventory, VEX predicates, scanner matching or release artefact selection changes; a host preparation bundle that carries raw and VEX-filtered Grype reports, or a release with matching-commit scan artefacts (activation → live)
repo: agentbox
domain: BASELINE-container
---

# ADR-2137 — Image-scoped vulnerability evidence

## Scoped source check — 2026-11-09

Shared composition changes add gated StatCraft (rebuild-class catalogue),
update pinned VisionCraft/dependency packages, and replace the bounded .local
tmpfs with a named volume. Nested OpenCode/code-server volumes retain their
identities. Codex remote startup stays manual; the removed feature flag is
not written. This does not widen listeners, authority or retrieval geometry.
The local-home migration fixture, 26 persistence/delivery tests, 25 supervisor
checks, 13 boot checks, manifest validation and port/listener gates pass.
See [local storage migration](../developer/local-home-storage.md). Runtime
acceptance remains separate; existing status axes and open limitations remain.

## Scoped source check — 2026-11-05

The only new shared-flake delta since the previous verification pins OpenSSH
10.6p2 and its upstream SHA-256 together, without changing listeners, mounts,
role mappings or this record's own feature gate. Upstream's 2026-11-05 release
adds the Linux musl/PAM-disabled password-auth workaround. This is a custom
package override: image VEX must not claim a stock nixpkgs OpenSSH build.
Runtime acceptance and all existing status limitations remain separate.

## Scoped source re-verification — 2026-11-03

Shared-file changes add pinned VisionCraft and direct AQE registration, retire
the unused precedent-bridge default, and extend governance custody/config
scrubbing. This record's own mechanism is retained; existing partial/staged
limitations and historical receipts are not promoted to new runtime acceptance.

Evidence: [rebuild verification receipt](../estate-closeout/adr-reverification-2026-11-03.md).
This verifies the scoped source amendment, not new whole-record runtime
acceptance. Decision, implementation and activation statuses are unchanged.

## Scoped re-verification — 2026-10-31

Reviewed the governed-path delta since the previous verification: only the
operator user-cron gate, devuser supervisor block, rebuild-class catalogue entry
and its boolean schema registration changed. Existing capability, identity,
storage and network contracts are unchanged. Preflight, manifest validation,
25 role-isolation supervisor checks and the user-cron schema regression pass.
This does not promote any activation status or claim a live role-isolation rehearsal.

## Re-verification — 2026-10-29 at 3b498088e (ADR-2153 cutover)

Reviewed the governed-path diff from this record's previous verification to
`3b498088e5a35e78158a9eb8d6f0266996d31f82`. Shared manifest, schema, supervisor and bootstrap changes
are scoped to the owned session plane: AoE and its token consumers retire,
provider provisioning moves, and session status hooks are added. Other named
capability sections and their status axes retain their existing claims.
Validation: session-plane tests (44 unit, 15 integration), manifest projector
suite and Clippy for both crates, proxy selftest (zero failures/skips), hook
registration (12), role-supervisor isolation (25), boot projection (13), and
manifest catalogue/declared-state checks pass locally. This does not claim new
runtime acceptance of this record's unrelated capabilities.

## Re-verification — 2026-10-15

The only changed hunk in the governed agentbox.sh adds `security` to the subcommand allowlist (ER-14); its existing scanner dispatch is unchanged. CLI regression checks pass, and all 23 runtime-delivery tests pass. Instruction projection, executable volumes, image evidence and vendor routing are unchanged.
Source anchor: `df584b3fd`. Existing status axes and deferred work remain unchanged.


## Context

Generic vulnerability matches can name code that a Nix package never builds or
ships. The NixOS VEX approach evaluates those claims against a system's build
and configuration. Agentbox uses `nix2container` and supervisord rather than a
NixOS system configuration; host-kernel and NixOS-service assumptions do not
describe its container payload.

## Decision

Enumerate shipped store paths from `image.layers.paths`, not the builder
closure. Expose a Nix evidence output on each image variant and a pinned host
scanner environment. Generate SBOM/OpenVEX reports on the host during
preparation and CI image builds, and retain them outside the runtime image.
No daemon, adapter or manifest gate is added.

A private MIT OR Apache-2.0 Rust emitter generates statements only for exact
versioned PURLs present in the SBOM as subcomponents of the image-scoped
product. Its initial OpenSSH `CVE-2007-2768` rule requires reviewed source/build
identity and absence of OPIE filenames across the whole shipped
payload. False or unknown conditions withdraw the statement.

Host scans keep raw and VEX-filtered Grype reports and gate the
remaining findings at high severity by default. CI retains independent
Trivy/Syft checks, uses the matching source/build run and each architecture's
immutable digest, and releases attach only matching-commit scan artefacts.
Local preparation uses the image JSON hash until a scan binds the evidence to
the published OCI digest.

Convert the scoped CycloneDX inventory to native Syft and SPDX exports, checking
that conversion preserves the package PURLs. Give the native scanner source
the same generic image identity as OpenVEX, and explicitly enable Grype's CPE
generation for Nix matching. Preserve the original sbomnix CSV as a labelled
raw debugging export. Release publication verifies the tag's architecture
digests against its attached scan evidence.

## Consequences and verification

Statements assess the immutable image only; host kernels, mounts, sidecars and
imperative runtime changes require separate assessment. No general NixOS feed
is imported. Rule changes need positive and withdrawal fixtures and a scanner
check against a rebuilt image. The rollout is staged for the next rebuild;
fixture checks do not certify a live image or a current vulnerability database.

Local verification passed ten Rust fixtures, formatting and clippy, 32 host
scan/lifecycle fixtures, Bash syntax and actionlint. Nix syntax was parsed;
Nix evaluation and a full image build were not run in this container.
The pinned Syft 1.44.0 and Grype 0.113.0 synthetic interoperability check
produced 77 raw findings and suppressed precisely one matching fixture finding;
changed image or package identity retained all 77. Scoped SPDX generation and
rebinding were also exercised through the Rust CLI. These are test results,
not an assessment of the live image.

See the [operator and maintainer guide](../developer/vex.md).

## Re-verification — 2026-10-13 at `044f1d689`

The decision holds. Every claim below was checked against the code, and the tripped hunks are unrelated to it.

Claims checked:

- Shipped store paths enumerated from image.layers.paths, not builder closure; evidence output on each image variant; pinned host scanner environment
- No daemon, adapter or manifest gate added (host-only tooling)
- Private MIT OR Apache-2.0 Rust emitter; initial OpenSSH CVE-2007-2768 rule requires reviewed stock build identity and absence of OPIE filenames across the whole payload; false/unknown withdraws the statement
- Statements only for exact versioned PURLs present in the SBOM as subcomponents of the image-scoped product
- Host scans keep raw and VEX-filtered Grype reports; gate remaining findings at high by default
- CI retains independent Trivy/Syft checks; uses the matching source/build run and each architecture's immutable digest; releases attach only matching-commit scan artefacts; release verifies tag's architecture digests against attached evidence
- Local preparation uses the image JSON hash until a scan binds to the published OCI digest
- Scoped CycloneDX converted to native Syft + SPDX, checking conversion preserves package PURLs; same generic identity as OpenVEX on the native source; Grype CPE generation explicitly enabled; original sbomnix CSV preserved as labelled raw export
- Verification counts: ten Rust fixtures; 32 host scan/lifecycle fixtures

Evidence:

- git diff --stat 3baa60024..de7fa461e over the verified_paths → agentbox.sh (+100: only the ADR-2139 `systemone backend|proxy` subcommands), flake.nix (+82: hunks at 262, 939, 1799, 1950, 2028, 2937 — none touch the vex/securityEvidence/securityTools lines, which are at 141-147 and 4554-4583), services/agentbox-vex/README.md (licence text), services/agentbox-vex/src/main.rs (+30: scope_native now excludes type=file CycloneDX entries from the PURL-preservation comparison and adds one test). All other verified_paths unchanged
- lib/vex-evidence.nix:7-15 jq '[.layers[].paths[].path] | unique' over the nix2container image JSON into a separate payload root; flake.nix:4554-4575 securityEvidence attached inside mkImage so every variant has it; flake.nix:141-147 securityTools symlinkJoin (agentbox-vex, sbomnix, syft, grype, skopeo, jq); flake.nix:4582-4583 exposes security-tools / agentbox-vex as host packages
- lib/agentbox-vex.nix: host-build comment 'not in the image'; services/agentbox-vex/Cargo.toml: publish=false, license 'MIT OR Apache-2.0'; no [security]/vex manifest key or supervisor program found in flake.nix (only the packages)
- services/agentbox-vex/src/main.rs:15 CVE const; :218-231 opie_name; :233-240 find_opie over shipped payload names; :272 requires metadata openssh.stock_build == true; :303-311 rule openssh-no-opie-v1 withdraws (no suppression) when OPIE present or evidence incomplete; :345,:377,:632-633 emits sbom.nix.spdx.json, sbom.nix.syft.json, sbomnix.raw.csv, SPDX-2.3
- scripts/security-scan.sh:20 fail_on=high default; :68-69 sbomnix --cdx/--spdx/--csv (sbomnix.raw.csv kept); :98-99 grype on the native Syft SBOM with --add-cpes-if-none; :101 grype.raw.json then :104 grype --vex ... filtered with --fail-on gate; :34 scan requires repository@sha256:DIGEST
- .github/workflows/image-scan.yml:3 'Grype/VEX + Trivy + Syft', :70-76 downloads this architecture's evidence from the triggering run, :87 jq source_revision/arch/build_run_id match, :135 --fail-on high, Trivy at :137-158, anchore/sbom-action at :166-175; build-multi-arch.yml:81-89 builds securityEvidence+security-tools and runs report, :158-164 binds to registry digest and writes publication.json; release.yml:70-82 resolves tag to per-arch digests, :157-160 verifies publication.json source_revision/arch/image_ref and bundle.json subject == digest and grype exit 0; flake-check.yml:72-73 evals securityEvidence and security-tools drvPaths
- scripts/runtime-delivery.cjs:161-170 builds .#runtime.securityEvidence and .#security-tools and runs security-scan.sh report; services/agentbox-vex/src/main.rs:19,:421 hashes image.json for the local subject
- cargo test --locked --offline in services/agentbox-vex (scratch target dir) → 11 passed (ADR says ten; the eleventh is the post-anchor fixture native_export_distinguishes_config_files_from_unversioned_packages)
- node --test tests/security/security-scan.test.cjs → 9 pass; node --test tests/config/runtime-delivery.test.cjs → 23 pass (9+23 = 32 matches the ADR's '32 host scan/lifecycle fixtures')

Commands run: `git diff 3baa60024..de7fa461e -- <verified_paths>; cargo test --locked --offline (services/agentbox-vex); node --test tests/security/security-scan.test.cjs; node --test tests/config/runtime-delivery.test.cjs`

Not checked, and notes: Not re-checked, and the record itself disclaims them: Nix evaluation/full image build, the pinned Syft 1.44.0 + Grype 0.113.0 synthetic interop run (77 raw findings, exactly one suppressed; syft/grype are not on this container's PATH and I did not fetch them), actionlint, vex-grype.integration.sh (needs those binaries). Those figures are therefore carried forward from the record unverified. The post-anchor main.rs change narrows 'checking conversion preserves the package PURLs' to software components (type=file config entries are no longer compared because Syft's decoder omits them); the claim as worded still holds and the record may optionally note it. The 'ten Rust fixtures' figure is now eleven. Recommend re-stamp at de7fa461e with those caveats.

Checked at `218dc12c3` by reading each claim against the code, not by the staleness diff alone. Stamped at `044f1d689`, which adds only the gate fixes in `config/custody/env-classes.json`, the `check-manifest-catalogue` baseline, `services/agentbox-vex`'s README and licence notice, a stale `agentbox.toml` comment, a stale `paths` example in the ontology-augment docs, and the grounding test's stub.

**Re-verified 2026-10-16 at `efa293b8799b`.** The only change to a governed path is the sidecar-first Blender work (ADR-2142): `agentbox.toml` gains `[skills.spatial_and_3d].blender_local = false`; `flake.nix` narrows one `lib.optionals` condition (`wrapGpuBin pkgs.blender` now needs `blender && blender_local`), adds one `ENABLE_BLENDER_LOCAL` env line and reworks a comment; `schema/agentbox.toml.schema.json` gains the `blender_local` boolean; `management-api/lib/system-manifest.js` gains a `blender-local` catalogue entry and a corrected `blender-mcp` summary. The decision stands, but action follows from it: Blender and its dependency PURLs leave `image.layers.paths` at the next image, so existing VEX statements bound to them must be withdrawn and the evidence regenerated from that image; this note does not regenerate it. Checked 2026-10-16: the only rule in `services/agentbox-vex` is OpenSSH `CVE-2007-2768` and nothing in it references Blender, so no statement is bound to a Blender PURL and none needs withdrawing; the next scheduled scan of the new image simply carries no Blender inventory. Re-verified by `git diff <previous verified_commit>..efa293b8799b -- <verified_paths>`; no re-implementation was needed.

Re-verified 2026-10-19 at `dfe78f0766e52ae6cfbae32c395e22c9590d6785`: Reviewed governed-path changes: the flake only repins the vault source; the entrypoint delta corrects the role-isolation class comment; the catalogue makes the baked privilege change rebuild-class. No ingress, retrieval geometry, capability gate, image-delivery or subsystem runtime configuration is changed by those deltas. Existing implementation and activation statuses are retained.

Re-verified 2026-10-19 at `52183d76fde866ab1f05aea524aeea33d8573c3f`: The reviewed flake delta adds the local-cuda-gated stable nvcc link, and the entrypoint/catalogue propagate and describe its scoped host compiler. Backend and wrapper gates pass (23 and 21 assertions); no ingress, role isolation, durable adapter, retrieval or subsystem gate is changed. Image evidence will be regenerated for the new layer closure. Existing status axes are retained.

Re-verified 2026-10-20 at `61f27d5b375f9838ef7b7334e3f984d0d4a9ea70`: reviewed the governed-path delta for the managed floor (ADR-2144) and alpha.17 forge/proxy launcher (ADR-2145). The schema and capability catalogue now register these settings, with boot-class floor projection and rebuild-class forge/proxy changes. Bridge path dependencies use the same alpha.17 source as the server; the independent core-only registry dependency retains its upstream pin. Claude Code 2.1.304 and Codex 0.163.0 retain the full upstream package resources. Manifest validation, all 94 catalogue gates, 37 targeted Node tests, 12 instruction-layer assertions and skill lint pass. No ingress publication, adapter dispatch, retrieval geometry, mount or role-isolation gate changes. Build and activation evidence is pending; existing status axes are retained.

Re-verified and deployed 2026-10-20 at `dd6ff7e065a9a2851f7cfa9fa8c71305ce2a8782`: the reviewed flake/Compose delta adds only a root-owned 1 MiB tmpfs at `/etc/claude-code` so boot can project the managed floor on the read-only rootfs. Live file is uid 0, mode 0644, agent-readable and agent-unwritable; the same floor is present in the 13,605-byte Codex instructions. Root and all eight Claude profiles each register the three decline events once. Native pod alpha.17 serves `/forge` (HTTP 200), with testnet policy and zero mirror follows/announce relays; activity sink remains off. Readiness has no degradation, 32 persistent mounts are unchanged, and the other 17 containers are unchanged (speech-to-text was separately rebuilt for its tested marker-ordering fix). The image SBOM/VEX evidence was regenerated for the shipped image; this does not claim an online vulnerability scan or cover the host and sidecars. Existing decision and status axes are retained unless the record explicitly states activation below.


## Re-verification — 2026-10-21

The composition diff refreshes locked package/source versions and the Go compiler for web-researcher. Supervisor blocks, ingress bindings, adapter dispatch and persistent mounts are unchanged. The generated Compose file is byte-identical. Manifest validation, the 95 catalogue gates, 45 agent-reconciliation checks and 25 role-supervisor checks pass. This is source verification; image activation and live checks remain separate deployment evidence.

Re-verified at `c8c20341c66feec751fe6234167c220c70fe2ffb`: the only governed code delta is the REUSE
Sphinx builder string correction. Both documentation outputs and all 872
enabled package tests pass; 23 runtime-delivery checks pass. Runtime
boundaries and activation status are unchanged.

Re-verified at `9173cdba6f0a84556bbd4c059db0a7e823aa7a2d`: the governed delta isolates Typepy 1.3.5
and fixes wrapper arguments for host-only sbomnix. Its dependency suites
pass (834 Typepy, 1682 SimpleSQLite), 23 delivery checks pass, and an actual
shipped-path smoke scan emits CycloneDX, SPDX and CSV. Runtime and activation
contracts remain unchanged.

## Re-verification — 2026-10-21 at 73bd631c0

Reviewed the committed change to the Codex home: the parent tmpfs becomes a
named volume; its package volume and credential bind remain independent. No
supervisor, ingress, toolchain, feature-gate, scanner or instruction-projector
code changes. Compose persistence and runtime-delivery checks pass (24 tests),
Compose refresh checks pass (3 tests), and role-supervisor checks pass (25 tests).
This mount migration is explicitly outside fast activation (ADR-2147).

## Re-verification — 2026-10-21 at 395380f71

Reviewed the committed remote-media change against this record. Nix changes
only the ComfyUI MCP dependency closure and its existing builtin/external gates;
`skills/mcp.json` changes only Blender's declared protocol. Blender's optional
local binary, proxy and background-job safety boundaries remain intact. No
identity, ingress, daemon role, instruction projection, persistent mount, scanner
or vendor-routing behavior changes. Media checks pass: 23 Node tests, 12 graph
client tests and 9 downloader tests. Runtime/Compose checks pass (27 tests),
role-supervisor checks pass (25), skills lint and loopback-port checks pass.
Sidecar image activation is tracked separately in the host deployment receipt.

Re-verified 2026-10-22 at `0382cc4b5e34f75a62184bf350f865533010dc52`: reviewed the delta adding an independent, opt-in Isaac Sim lifecycle and live-class service catalogue entry, the 130th routed skill, pinned regional ComfyUI nodes/model metadata, and Blender background Python failure propagation. Existing ingress, role isolation, instruction projection, durable adapters, retrieval geometry, System One selection and image evidence boundaries are unchanged. Isaac runner/contract (15), GPU picker, launcher selection, Blender bridge (19), role supervisor (25), skill lint and catalogue checks pass. Isaac vendor-image and fixture verification remains staged until executed.

**Re-verified 2026-10-23.** `scripts/security-scan.sh:62` changed `tool()` from `"$tools/bin/$@"` to a separate name and argument list (ShellCheck SC2145). One line replaced in place, so every `scripts/security-scan.sh:NN` citation above still holds and behaviour is identical. ShellCheck and Security VEX contracts are green on GitHub.

Re-verified 2026-10-23 at `951ada931e235ad45b61b2bef90b7e5c76f8d76c`: flake.nix delta does not touch the evidence path. Re-read at HEAD: `vexPkg` and `securityTools` (flake.nix:169-174), per-variant `securityEvidence = import ./lib/vex-evidence.nix` over the built `image` (flake.nix:4635), the OpenSSH `stock_build` comparison against a pristine nixpkgs import (the overlay does not apply to it), and `packages.security-tools` / `agentbox-vex` outputs (flake.nix:4663-4664). The cacert override only changes the `ca-bundle` package version and contents; no VEX rule targets it. In a detached worktree at HEAD, `node --test tests/security/security-scan.test.cjs` passes 9/9 and `cargo test --offline --manifest-path services/agentbox-vex/Cargo.toml` passes 11. Nix evaluation and a rebuilt-image scan were not run.

### Re-verification — 2026-10-29 (ADR-2154 Pele renderer)

`21769a881..d1dd896f4`: `flake.nix` replaces the `mermaidSidecarCliPkg` shell wrapper with `lib/pele.nix` (`pele-render` and an `mmdc` shim, still gated by `[skills.docs].mermaid`) and puts the two commands in `npmCliGatedPackages` in its place; no other gate, pin or supervisor text changes. Nothing ADR-2137 governs changes meaning. The decision holds. Re-verified by reading `git diff 21769a881..d1dd896f4 -- flake.nix` (new hunks only). Nix was not evaluated here; the image is unverified until the host rebuild.


Re-verified 2026-10-29 at `00039efb1e4a70402df86ad19cf76894fe3b9a8f` for ADR-2155. Reviewed the typed-decision activation diff against this record: the changed manifest, bootstrap, catalogue or source-pin hunks do not alter its governing boundary. Existing status axes and runtime evidence limits are retained. No image or service activation is claimed.

Re-verified 2026-10-31 at `b65c3d4ed`. Governed paths changed: `flake.nix`: the ontomark comment now names the verbs it owns (`4a07fbfb3`). No section this record governs changed; the decision holds. Re-verified by `git diff 358e5d32c..b65c3d4ed -- <verified_paths>`; no re-implementation was needed. The image carries it at the next rebuild.

## Re-verification — 2026-11-01 (`cc949bb79`)

Governed-path delta since `753788564` is the RuVector Postgres credential custody change (ADR-2164 amendment 2), nothing else:

- `agentbox.sh`: the ruvnet-brain ingest command line no longer passes a conninfo (the in-container client reads the password file), plus one comment.
- `flake.nix`: removes the claude-flow config template (`claudeFlowConfigJson` and its `cp`) and the baked `RUVECTOR_PG_CONNINFO` image Env entry, and rewords one dream-engine supervisor comment.
- `tests/security/zai-launch-env.test.cjs`: the test variable `RUVECTOR_PG_CONNINFO` is swapped for `RUVECTOR_PG_HOST`.

Nothing this record decides is changed; its status axes are unchanged. Re-run: `git diff 753788564..cc949bb79 -- agentbox.sh flake.nix tests/security/zai-launch-env.test.cjs`.

Re-verified 2026-11-05 at `3beca506c` for ADR-2177: SuperSplat adds image store paths and no daemon, adapter or gate to the VEX method; evidence generation is unchanged.

Re-verified 2026-11-07 at `1cf3f86ff`. Governed-path delta since `18b79218d`: `lib/sbomnix.nix` only. nixpkgs 6b01148e2e97 now ships sbomnix's `makeWrapperArgs` as the four separate `--prefix PATH :` arguments that this override produced, so the shape assert accepts exactly that form (passed through) or the old single fragment (split, as before) and still fails on anything else. The wrapped PATH, the tools in `securityTools` and evidence generation are unchanged; the decision and status axes are unchanged. Re-run: `git diff 18b79218d..1cf3f86ff -- lib/sbomnix.nix`.

Re-verified 2026-11-08 at `a0f91fba2`. Governed-path delta since `1cf3f86ff`: five workflows, all from the CI pare-back `840468521`. `build-multi-arch.yml`, `image-scan.yml` and `release.yml` gain only job `timeout-minutes` (240/15, 45, 20). `flake-check.yml` gains `workflow_dispatch` and `timeout-minutes: 20`. `security-vex.yml` gains `concurrency`, `timeout-minutes: 15` and a `rust-cache` step for `services/agentbox-vex`. Its path filter narrows from `.github/workflows/**` to `security-vex.yml`, `build-multi-arch.yml`, `image-scan.yml` and `release.yml`, so an edit to the governed `flake-check.yml` alone no longer re-runs the VEX contracts. No evidence, scan, digest-binding or release-selection step changes. Citations shift by one or two lines: `image-scan.yml` download `:72`, publication match `:88`, `--fail-on high` `:136`; `build-multi-arch.yml` evidence build `:82`, report `:90`, `publication.json` `:165`; `release.yml` tag resolution `:71-83`, publication verify `:155-158`; `flake-check.yml` evidence evals `:74-75`. The decision and status axes are unchanged. Re-run: `git diff 1cf3f86ff..a0f91fba2 -- <verified_paths>`.

Re-verified 2026-11-10 at `571c0ad43` (PR #45, ADR-2191, the Bend toolchain). Governed-path delta since `e2b49adfc`: `flake.nix` gains `bendLib` and `bendPackages`, one `++ bendPackages` in `allPackages` and one in the `toolchains` layer group, and `ENABLE_BEND` in the image environment. Every hunk is an addition apart from one re-wrapped line in the `toolchains` layer group. The change adds a gated language toolchain and no listener, published port, mount, volume, supervisor program, secret, identity, model route, vault path, registry entry or Nostr kind, and it alters no existing gate, so what this record decides is not touched. **Review trigger considered** (image inventory). The inventory mechanism is unchanged; the shipped set gains the Bend launcher, its release executable (prebuilt native code) and the BendTT kernel when the gate is on. No SBOM or VEX has been generated for an image containing them, so nothing is claimed about scanner matches for those paths. CI on that commit passed the flake evaluation on both architectures, config validation with the TUI round trip, the contract and adapter suites and the custody rehearsal. Re-run: `git diff e2b49adfc..571c0ad43 -- <verified_paths>`.

Re-verified 2026-11-11 at `237178730` (ADR-2192, ADR-2193, ADR-2194 at `04638a618`; ADR-2195 at this commit). Governed-path delta since `571c0ad43`: `flake.nix` gains `supervisordLauncher`, listed ahead of `pythonRuntimeEnv` in `pythonBasePackages` (ADR-2193: PID 1 is started by the runtime env's interpreter; the entrypoint's `exec supervisord` line is unchanged), `motionRenderPkg` in `skillToolPackages` (ADR-2194), and the CAD gate (ADR-2195): `cadLib`, `cadEnabled`, two gated additions to `spatialPackages`, a gated `[program:cad-engine]` block bound to `127.0.0.1:3245`, gated `/usr/share/fonts` links and `ENABLE_CAD` in the image environment. **Review trigger considered** (image inventory). With both CAD gates off the shipped set gains two payloads: the `supervisordLauncher` script and the `motion-render` binary (prebuilt Rust). With `cad = true` it would gain 96 prebuilt Python wheels as `fetchurl` outputs in a link farm, plus CPython 3.13 and Xvfb. Those wheels are archives in `image.layers.paths`, not installed packages, so whether the SBOM names their contents with PURLs a scanner can match is NOT established; the environments unpacked from them live on the workspace volume, outside the image. No SBOM or VEX has been generated for an image containing any of this. Run on this commit in the container: the configuration jest suites (294 passed), `skill-lint`, `skill-count-check`, the manifest validator, the egress register check, the secret inventory, the crate licensing check, the role-isolation and runtime-contract shell tests, `python-runtime-path` and `cad-launcher`. The flake was NOT evaluated (no Nix in the container) and no image has been built from it. The decision and status axes are unchanged. Re-run: `git diff 571c0ad43..237178730 -- <verified_paths>`.

Re-verified 2026-11-11 at `924f4282a` (ADR-2196). Governed-path delta since `237178730`: `agentbox.sh` deletes the remote-host step that ran `npm install -g agent-browser playwright` and `npx playwright install chromium`; `flake.nix` adds `semgrep`, `gitleaks`, `trivy` and `jujutsu` to the ungated `basePackages`; removes `codexMcpPkg`, its `npmServicePackages` entry and its copy into the openai-codex skill folder (the codex CLI, `toolchains.codex` and the codex-plugin-cc payload are unchanged); and gives `[program:podcast-cron]`'s `environment=` PATH util-linux and `vaultPackages` via `lib.makeBinPath`. **Review trigger considered** (image inventory). The shipped set gains four prebuilt nixpkgs CLIs (semgrep, gitleaks, trivy, jj) and util-linux on one supervised program's PATH, and loses the openai-codex MCP server's npm closure. No SBOM or VEX has been generated for an image containing them. Run on this commit: skill lint (124), skill-count, routing-table, the manifest validator, router and configuration jest, the corpus test (its baked-versus-repo comparison fails in-container until the next rebuild), and the agentbox-manifest and podcast-ingest cargo tests. The Nix changes are not evaluated or built. The decision and status axes are unchanged.

Re-verified 2026-11-11 at `0ed05167b` (ADR-2196, removal of the dead `skills.browser.playwright` switch). Governed-path delta since `924f4282a`: `flake.nix` drops `playwright` from the security-exception filter and `ENABLE_PLAYWRIGHT` from the image environment (the playwright skill is gone and local browsers are forbidden here). No published port, mount, secret, identity, route, vault path or registry entry changes, so what this record decides is not touched. Run on this commit: the manifest validator, manifest catalogue, configuration jest (301), agentbox-manifest cargo tests (235), skill lint (124). The flake edits are two whole-line deletions, not evaluated. The decision and status axes are unchanged.

Re-verified 2026-11-11 at `f475e0b8e` (ADR-2196, removal of the dead `skills.browser.qe_browser` switch). Governed-path delta since `0ed05167b`: `flake.nix` drops `ENABLE_QE_BROWSER` from the image environment (nothing read it). No published port, mount, secret, identity, route, vault path or registry entry changes, so what this record decides is not touched. Run on this commit: the manifest validator (live and default manifests), manifest catalogue, configuration jest (301), the TUI non-interactive validation (5), agentbox-manifest cargo tests (235). The flake edit is one whole-line deletion, not evaluated. The decision and status axes are unchanged.
