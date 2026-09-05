# Licensing of the `services/` subtree

The crates in this directory are licensed under either of

- MIT License (`LICENSE-MIT` in each crate directory), or
- Apache License, Version 2.0 (`LICENSE-APACHE` in each crate directory),

at your option, as declared in each crate's `Cargo.toml`. This differs from
the rest of the repository, which is AGPL-3.0-only under the root `LICENSE`.
The split is deliberate and recorded in `docs/adr/ADR-2030`: these crates are
self-contained, clean-room modules meant for reuse and publication to
crates.io, while the repository as a whole remains a copyleft hosted service.

Exception: a crate here that links an AGPL-licensed library cannot grant
permissive terms and declares `AGPL-3.0-only` in its own manifest
(`nostr-pod-bridge`, which links `solid-pod-rs-nostr`). It ships the full AGPL
text as `LICENSE` and a README that states in terms that it is **not**
dual-licensed, so it cannot be published under the permissive assumption.

Contributions to this subtree are accepted under the same MIT OR Apache-2.0
terms unless a crate's manifest says otherwise; contributions to
`nostr-pod-bridge` are accepted under AGPL-3.0-only.

## Per-directory state (2026-09-05)

Every package directory now carries the texts its manifest declares. Verified by
`scripts/ci/check-crate-licensing.sh`, which is a step in
`.github/workflows/invariants.yml`, and by `cargo package --list`, which shows
the files inside each crate's package payload.

| Directory | Declared licence | Licence texts present | README |
|---|---|---|---|
| `agentbox-manifest` | MIT OR Apache-2.0 | `LICENSE-MIT`, `LICENSE-APACHE` | yes |
| `agentbox-mcp` | MIT OR Apache-2.0 | `LICENSE-MIT`, `LICENSE-APACHE` | yes |
| `agentbox-ops` | MIT OR Apache-2.0 | `LICENSE-MIT`, `LICENSE-APACHE` | yes |
| `dream-engine` | MIT OR Apache-2.0 | `LICENSE-MIT`, `LICENSE-APACHE` | yes |
| `nostr-pod-bridge` | **AGPL-3.0-only** | `LICENSE` (AGPL-3.0 full text) | yes — states NOT dual-licensed |
| `ontology-tools` | MIT OR Apache-2.0 | `LICENSE-MIT`, `LICENSE-APACHE` | yes |
| `podcast-ingest` | MIT OR Apache-2.0 | `LICENSE-MIT`, `LICENSE-APACHE` | yes |
| `skill-tools` | MIT OR Apache-2.0 | `LICENSE-MIT`, `LICENSE-APACHE` | yes |

Eight package manifests, seven permissive and one AGPL — the same split the
2026-09-04 inventory found, now with the declared texts actually on disk. The
copyright holder and year range match the repository `NOTICE`:
`Copyright (c) 2024-2026 DreamLab AI / Dr John O'Hare`. The Apache-2.0 text is
the canonical upstream text with only the appendix boilerplate copyright line
filled in; the MIT text is the canonical SPDX `MIT` text.

Each manifest also declares `description`, `repository` and `readme`, which is
what a crates.io publish needs beyond the licence itself.

## What this notice still does not establish

Files on disk and metadata in a manifest are a packaging precondition, not a
release. This notice is **not** evidence that any crate has been published, that
its dependency graph is licence-compatible for distribution, or that the
copyright holder has authorised publication. Before a first publication:

- review the crate's full dependency graph for licence compatibility with the
  declared grant (a permissive crate that gains an AGPL dependency is a licence
  change and reopens [ADR-2030](../docs/adr/ADR-2030-permissive-licensing-for-publishable-service-crates.md));
- bind the release to a source revision, manifest, dependency graph, notices and
  archive digest through the designated maintainer process;
- verify any extracted repository and consumed Nix revisions separately.

See [ADR-2030](../docs/adr/ADR-2030-permissive-licensing-for-publishable-service-crates.md)
for package acceptance and extraction follow-up.
