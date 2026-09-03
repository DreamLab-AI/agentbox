# Licensing of the `services/` subtree

The crates in this directory are licensed under either of

- MIT License (`LICENSE-MIT` in each workspace), or
- Apache License, Version 2.0 (`LICENSE-APACHE` in each workspace),

at your option, as declared in each crate's `Cargo.toml`. This differs from
the rest of the repository, which is AGPL-3.0-only under the root `LICENSE`.
The split is deliberate and recorded in `docs/adr/ADR-2030`: these crates are
self-contained, clean-room modules meant for reuse and publication to
crates.io, while the repository as a whole remains a copyleft hosted service.

Exception: a crate here that links an AGPL-licensed library cannot grant
permissive terms and declares `AGPL-3.0-only` in its own manifest
(`nostr-pod-bridge`, which links `solid-pod-rs-nostr`).

Contributions to this subtree are accepted under the same MIT OR Apache-2.0
terms unless a crate's manifest says otherwise.
