---
id: ADR-2137
title: Generate image-scoped SBOM and VEX from shipped Nix payloads
date: 2026-10-11
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 0382cc4b5e34f75a62184bf350f865533010dc52
verified_paths: [flake.nix, lib/sbomnix.nix, lib/sbomnix-python.nix, lib/agentbox-vex.nix, lib/vex-evidence.nix, services/agentbox-vex, scripts/security-scan.sh, scripts/runtime-delivery.cjs, agentbox.sh, tests/security, tests/config/runtime-delivery.test.cjs, .github/workflows/build-multi-arch.yml, .github/workflows/image-scan.yml, .github/workflows/release.yml, .github/workflows/security-vex.yml, .github/workflows/flake-check.yml]
owner: jjohare
review_trigger: image inventory, VEX predicates, scanner matching or release artefact selection changes
repo: agentbox
domain: BASELINE-container
---

# ADR-2137 — Image-scoped vulnerability evidence

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
