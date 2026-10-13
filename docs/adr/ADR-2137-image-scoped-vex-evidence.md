---
id: ADR-2137
title: Generate image-scoped SBOM and VEX from shipped Nix payloads
date: 2026-10-11
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 044f1d689569572417a98f91afcf744fc2ca2385
verified_paths: [flake.nix, lib/agentbox-vex.nix, lib/vex-evidence.nix, services/agentbox-vex, scripts/security-scan.sh, scripts/runtime-delivery.cjs, agentbox.sh, tests/security, tests/config/runtime-delivery.test.cjs, .github/workflows/build-multi-arch.yml, .github/workflows/image-scan.yml, .github/workflows/release.yml, .github/workflows/security-vex.yml, .github/workflows/flake-check.yml]
owner: jjohare
review_trigger: image inventory, VEX predicates, scanner matching or release artefact selection changes
repo: agentbox
domain: BASELINE-container
---

# ADR-2137 — Image-scoped vulnerability evidence

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
