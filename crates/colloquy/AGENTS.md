# colloquy crates — binding constraints

- **Published vs internal:** `colloquy-core`, `colloquy-view`, `colloquy-nostr` and `colloquy-store` are published to crates.io and must stay estate-agnostic. `colloquy-backends` and `colloquy-mcp` are internal — they are the only crates allowed to bind to `nostr-bbs-core` signing and to the governed `ruvector-mcp.cjs` server.
- `colloquy-core` is the standard: pure, wasm-capable, Apache-2.0. `colloquy-view` depends on core alone — the forum consumes both from crates.io and must never gain a path edge into this repo.
- `colloquy-nostr` owns its NIP-01 structs (no Nostr-library coupling) and uses kinds **38410–38415** (moved from 38100–38105 by ADR-2105).
- `colloquy-store` is local / shared / relay behind one trait. It is **not** a sixth adapter slot; durable state still rides the five slots.
- Confidence counts **authorising principals**, never accounts: an operator's agents are one voice, and an unregistered pubkey is dropped rather than self-authorising.
- The MCP binary is registered via `/opt/agentbox/bin/…`, never a `/nix/store` path.
- Published crates ship full rustdoc (`deny(missing_docs)`), README, licence and repository metadata; `cargo doc --no-deps` must be warning-free.

Detail: [`docs/reference/claude-context/crates.md`](../../docs/reference/claude-context/crates.md). Governing records: ADR-2085, ADR-2086, ADR-2105.
