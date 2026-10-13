# Image SBOMs and VEX

Agentbox emits a Nix-derived software bill of materials (SBOM) and an OpenVEX
document alongside each image build. VEX records why a particular vulnerability
does or does not apply to a particular shipped component. It lets Grype filter
reviewed findings while preserving the original scan for comparison.

Evidence follows the image's actual shipped store paths, enumerated from
`nix2container`'s `image.layers.paths`. A builder's derivation closure can contain
compilers and other dependencies that never reach the image, so it is not the
payload inventory. See [ADR-2137](../adr/ADR-2137-image-scoped-vex-evidence.md).

## Build and inspect offline evidence

`build`, `up --build`, `prepare`, `rebuild` and the CI image build produce the offline report before
promoting an image candidate. This does not download a vulnerability database
or run an online scan. The report remains outside the runtime image and adds no
daemon, adapter slot, port or manifest capability.

You can generate a report directly on a Nix-capable host:

```sh
./agentbox.sh security report --variant runtime --output .agentbox-build/security/runtime
```

`security report` builds `.#runtime.securityEvidence`, then uses the pinned host tools
in `.#security-tools` to generate the SBOM and statements. The Nix sandbox
produces the evidence; sbomnix runs on the host because it needs the host's Nix
store database. You can inspect the evidence separately:

```sh
nix build .#runtime.securityEvidence -o result-security-evidence
```

Supported variants are `runtime`, `full`, `desktop`, `cuda-runtime` and
`gaussian-splatting`. Each architecture and variant needs its own report;
evidence from one must not be applied to another. The default output directory
is `.agentbox-build/security/<variant>`.

Each offline report contains:

| File | Purpose |
|---|---|
| `build-evidence.json` | Shipped payload, build identity and rule predicates |
| `sbom.nix.cyclonedx.json` | Nix-derived CycloneDX inventory |
| `sbom.nix.spdx.json` | SPDX export of the same scoped inventory |
| `sbom.nix.syft.json` | Native scanner inventory with the explicit image identity |
| `sbomnix.raw.csv` | Raw sbomnix closure export for debugging; may include the synthetic root and unshipped grouped outputs |
| `vex.openvex.json` | Applicable OpenVEX statements |
| `assessment.json` | Rule decisions, including withdrawn or unknown conditions |
| `bundle.json` | Links the report's evidence and image subject |

Preparation retains the report in the generation's `security/` directory with
its candidate receipt. Before publication, the subject is the SHA-256 of the
`nix2container` image JSON. The online scan binds it to the architecture's real
OCI manifest digest. A successful offline report establishes that the evidence
was generated. It does not establish that there are no current vulnerabilities.

## Scan an immutable image

Run the host scanner against the exact image you intend to review:

```sh
./agentbox.sh security scan \
  --image ghcr.io/dreamlab-ai/agentbox@sha256:DIGEST \
  --report .agentbox-build/security/runtime \
  --variant runtime \
  --output .agentbox-build/security-review \
  --fail-on high
```

Use the immutable digest, not a moving tag. The Nix source, manifest, architecture
and build evidence must correspond to that image. The scan helper uses the
flake's `.#security-tools` environment, containing sbomnix, Syft, Grype and the
project-specific Rust emitter in `services/agentbox-vex`.
Supply the report produced by that build with `--report`. Without it, the
helper builds local evidence and rejects an image that differs from it.

The helper converts the verified CycloneDX inventory to `sbom.nix.syft.json`
and gives its source the image's explicit name and digest. This preserves the
product identity needed by Grype's OpenVEX matcher; package PURLs come from the
verified inventory. It does not catalogue new packages during conversion.
Syft's package inventory excludes CycloneDX components typed as files (for
example `fonts.conf`); those remain in the authoritative CycloneDX inventory
and shipped-path evidence. Every software component, including packages without
a PURL, must survive conversion. SPDX is exported from that package inventory,
and both exports are hashed into the evidence bundle. Grype receives `--add-cpes-if-none` because Nix packages
need CPE matching and the offline report avoids network-based CPE enrichment.

`security scan` retains `grype.raw.json`, `grype.filtered.json` and a filtered
text table alongside the report bundle. The default severity gate is `high`;
a remaining high or critical finding fails the scan. Investigate remaining findings against
their upstream advisories and the shipped component. Preserve both reports
when accepting a finding or changing a rule.

An empty VEX statement list means that no reviewed suppression applies to the
current evidence. It is a valid outcome. A false or unknown predicate
withdraws the corresponding statement and returns the finding to ordinary
triage.

## What the initial rule proves

The initial assessment covers OpenSSH `CVE-2007-2768`. It requires the
reviewed nixpkgs revision and OpenSSH version/build identity and checks for
OPIE filenames across every shipped store path. It emits a `not_affected` statement only when the
reviewed identity matches and no such file is present. Unknown identity,
missing evidence or an OPIE file prevents suppression.

The SBOM root is an image-scoped `agentbox@sha256:<digest>` component. OpenVEX
statements name that product and only the exact versioned subcomponent package
URLs (PURLs) found in the SBOM. It does not emit a blanket statement for every
OpenSSH version or every Nix installation. The evidence records the rule's reasoning so a reviewer
can distinguish a successful predicate from an assumption.

Assessments cover the immutable image payload. They do not cover the
host kernel, mounted workspace or credentials, imperative package installs,
the browser container, the memory sidecar or any other Compose service. Those
need their own inventory and review. Runtime configuration claims such as
"password authentication is disabled" cannot be inferred from build evidence
when an operator can change that configuration later.

## CI and release artefacts

Manual multi-architecture image builds create offline evidence for each
architecture. Pushes and pull requests run the lightweight Rust and integration
checks; pushing source alone does not trigger a complete image rebuild.

`image-scan.yml` keeps the existing Trivy severity gate, informational scan,
SARIF output and Syft SBOMs. It also downloads the matching build evidence and
runs Grype with and without VEX against each architecture's immutable image
digest. It uses the source commit and build run that produced the image.
Trivy's gate remains independent of Grype's VEX filtering.

`release.yml` attaches security artefacts only from a successful scan for the
release's matching source commit and published architecture digests. A report from the latest unrelated workflow
run is not evidence for the release. Retain the image digest and build/scan
receipts with the artefacts when reviewing a published image.

## Maintain a rule

Treat a rule as a security assessment with executable conditions:

1. Review the advisory, affected source and Nix build recipe. Record the exact
   identity and the reason the vulnerable code is absent or unreachable.
2. Check the entire shipped payload. A package-local absence test is insufficient
   if another shipped path can contain the vulnerable code.
3. Bind the statement to exact versioned SBOM PURLs and the image being assessed.
4. Add fixtures for the positive case and for withdrawal: changed identity,
   changed build, missing evidence, added vulnerable files and absent or
   mismatched SBOM components.
5. Keep raw scanner output. Verify the filtered report with the pinned Grype
   version before accepting a new suppression.

Run the Rust checks before committing:

```sh
cargo test --manifest-path services/agentbox-vex/Cargo.toml
cargo fmt --manifest-path services/agentbox-vex/Cargo.toml --check
cargo clippy --manifest-path services/agentbox-vex/Cargo.toml --all-targets -- -D warnings
```

Check scanner interoperability with a synthetic vulnerable package inventory:

```sh
tools=$(nix build .#security-tools --no-link --print-out-paths)
bash tests/security/vex-grype.integration.sh "$tools" .agentbox-build/vex-matcher-check
```

This opt-in check downloads the Grype database when needed and verifies
product/subcomponent matching, withdrawal and preservation of unrelated
findings. Its synthetic VEX statements are test data, not security assessments.

Then build the evidence and report on each supported architecture and scan the
resulting digest. Fixture checks establish rule behaviour; they cannot replace
that end-to-end Nix build and scanner check. The initial rollout is staged for
the next rebuild; a live image scan is a separate verification step.

## Upstream context

[nixos-vex](https://github.com/datosh/nixos-vex) inspired this approach. Its
NixOS module evaluates service and kernel configuration against a reference
system; Agentbox is a `nix2container` image with supervisord, so importing that
module or applying its whole feed would make unsupported claims. Agentbox
generates its own narrowly scoped evidence and statements.

See the [OpenVEX specification](https://github.com/openvex/spec/blob/main/OPENVEX-SPEC.md),
[sbomnix](https://github.com/tiiuae/sbomnix) and
[Grype VEX documentation](https://oss.anchore.com/docs/guides/vulnerability/filter-results/).
