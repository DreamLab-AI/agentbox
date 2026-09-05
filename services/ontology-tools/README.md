# ontology-tools

Vault OntologyBlock parsing, OWL2 axiom validation and field-preserving edits.

Part of [agentbox](https://github.com/DreamLab-AI/agentbox); the crate lives at `services/ontology-tools` and is a
self-contained Cargo workspace.

`ontology-tools` handles the markdown side of the agentbox ontology: it parses
`OntologyBlock` sections out of vault notes, validates OWL2 functional-syntax
axioms, applies field-preserving edits, validates wiki-links, and can enrich
entries from a Perplexity-backed source.

### What it does

- Parses and rewrites `OntologyBlock` markdown without disturbing unrelated
  fields.
- Validates OWL2 functional-syntax axioms and reports the failing axiom.
- Checks wiki-link targets resolve inside the vault.
- Optionally enriches a block from an external research source.

### Usage

```sh
ontology-tools --help
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

<https://github.com/DreamLab-AI/agentbox> — path `services/ontology-tools`.
