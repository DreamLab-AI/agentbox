# skill-tools

Rust ports of agentbox skill tooling: BM25 search, Wardley mapping and docs validators.

Part of [agentbox](https://github.com/DreamLab-AI/agentbox); the crate lives at `services/skill-tools` and is a
self-contained Cargo workspace.

`skill-tools` holds the Rust ports of the agentbox skill helper scripts:
UI/UX Pro Max BM25 search and design-system generation, Wardley Map generation,
analysis and heuristics, and the docs-alignment validators.

### Binaries

| Binary | Purpose |
|---|---|
| `uiux-search` | BM25 search over the UI/UX corpus, plus design-system generation. |
| `wardley-generate`, `wardley-quick-map`, `wardley-mapper` | Wardley Map generation. |
| `wardley-heuristics`, `wardley-strategic-analyzer`, `wardley-interactive` | Map analysis and heuristics. |
| `docs-alignment` | Runs the docs-alignment validator suite. |
| `docs-validate-links` | Link resolution across the docs tree. |
| `docs-check-mermaid` | Mermaid diagram syntax validation. |
| `docs-detect-ascii` | Finds ASCII diagrams that should be Mermaid. |
| `docs-generate-report` | Renders the alignment report. |

### Usage

```sh
uiux-search --help
docs-alignment --help
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

<https://github.com/DreamLab-AI/agentbox> — path `services/skill-tools`.
