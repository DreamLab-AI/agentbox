# podcast-ingest

Evidence-backed podcast knowledge extraction into the ontology.

Part of [agentbox](https://github.com/DreamLab-AI/agentbox); the crate lives at `services/podcast-ingest` and is a
self-contained Cargo workspace.

`podcast-ingest` is the Rust port of the `podcast-knowledge-ingest` and
`podcast-bulk-ingest` skills. It performs the weekly evidence-backed extraction
of podcast knowledge into the ontology, applies the ledger-promotion pre-filter,
and supports one-off historical backfill.

### Binaries

| Binary | Purpose |
|---|---|
| `podcast-ingest` | Weekly incremental extraction run. |
| `podcast-promote` | Ledger-promotion pre-filter over extracted claims. |
| `podcast-bulk-ingest` | One-off historical backfill. |

### Usage

```sh
podcast-ingest --help
```

## Licence

Licensed under either of

- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE) or
  <http://www.apache.org/licenses/LICENSE-2.0>)
- MIT licence ([LICENSE-MIT](LICENSE-MIT) or
  <http://opensource.org/licenses/MIT>)

at your option.

This crate lives inside the [agentbox](https://github.com/DreamLab-AI/agentbox) repository, which as a whole is
AGPL-3.0-only. The permissive grant is per crate and travels with the crate:
`services/` is a deliberately permissive subtree so these modules can be reused
and published outside the hosted service. See
[ADR-2030](https://github.com/DreamLab-AI/agentbox/blob/main/docs/adr/ADR-2030-permissive-licensing-for-publishable-service-crates.md)
and [services/LICENSING-NOTICE.md](https://github.com/DreamLab-AI/agentbox/blob/main/services/LICENSING-NOTICE.md).

### Contribution

Unless you explicitly state otherwise, any contribution intentionally submitted
for inclusion in the work by you, as defined in the Apache-2.0 licence, shall be
dual licensed as above, without any additional terms or conditions.

## Repository

<https://github.com/DreamLab-AI/agentbox> — path `services/podcast-ingest`.
