# agentbox-mcp

Unified multi-tool MCP server for agentbox.

Part of [agentbox](https://github.com/DreamLab-AI/agentbox); the crate lives at `services/agentbox-mcp` and is a
self-contained Cargo workspace.

`agentbox-mcp` is a single Model Context Protocol server that exposes several
agentbox tools over one stdio transport instead of one process per tool:
ImageMagick operations, web-page summarisation, and Gemini URL-context
retrieval.

### What it does

- Serves the MCP tool surface for the bundled tools over stdio.
- Validates tool arguments before shelling out, so a malformed request is a
  typed error rather than an arbitrary command line.
- Keeps one process where the previous layout needed three.
- `agentbox-mcp hub --config /run/agentbox/mcp-hub.json` — the shared loopback
  streamable-HTTP hub (ADR-2034): starts each configured stdio MCP server once,
  initialises it once, and multiplexes every Claude Code session's requests onto
  it (`POST /<name>/mcp`, `GET /health`). Refuses any non-loopback bind; offers
  no GET stream; respawns a child that exits.

### Usage

```sh
agentbox-mcp --help
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

<https://github.com/DreamLab-AI/agentbox> — path `services/agentbox-mcp`.
