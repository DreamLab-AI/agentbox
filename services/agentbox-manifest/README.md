# agentbox-manifest

Boot-time TOML/JSON manifest projection for agentbox.

Part of [agentbox](https://github.com/DreamLab-AI/agentbox); the crate lives at `services/agentbox-manifest` and is a
self-contained Cargo workspace.

`agentbox-manifest` reads `agentbox.toml`, validates it against the agentbox
manifest schema, and projects the result into the JSON/env artefacts the
container boot path consumes. It replaces the inline `python3` block in
`config/entrypoint-unified.sh` and the four standalone manifest scripts, so the
boot path has one typed implementation with deterministic output ordering.

### What it does


- `mcp-hub-project` (ADR-2034): runs last in the boot `.mcp.json` sequence;
  lifts the listed stdio server definitions into a 0600 sidecar, rewrites their
  entries to `type: http` at the loopback hub, and writes the hub's runtime
  config. `--disable` restores the stdio entries.
- Parses the manifest and reports schema violations with the offending key path.
- Projects the manifest into the JSON shapes the entrypoint and the MCP
  projector read.
- Emits stable, sorted output so a projection diff is a real configuration
  change rather than map-ordering noise.

### Usage

```sh
agentbox-manifest --help
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

<https://github.com/DreamLab-AI/agentbox> — path `services/agentbox-manifest`.
