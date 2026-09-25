# sidestr crates — moved to sidestr-rs

sidestr-rs — Rust port of Melvin Carvalho's sidestr sidechains, AGPL-3.0-only: the economic engine for did:nostr agents. A did:nostr key is a sidechain wallet.

The five `sidestr-*` crates that used to live here were split out, with their history, to
their own repository on 2026-09-23 ([ADR-2112](../../docs/adr/ADR-2112-sidestr-crates-live-in-sidestr-rs.md)):

- Source, issues and CI: <https://github.com/DreamLab-AI/sidestr-rs>
- Published crates: [`sidestr-header`](https://crates.io/crates/sidestr-header),
  [`sidestr-core`](https://crates.io/crates/sidestr-core),
  [`sidestr-nostr`](https://crates.io/crates/sidestr-nostr),
  [`sidestr-wallet`](https://crates.io/crates/sidestr-wallet),
  [`sidestr-round`](https://crates.io/crates/sidestr-round)

All five are `AGPL-3.0-only`, attributed ports of upstream `siding`
(`github.com/sidestr/spec`), and are audited before every publish (ADR-2106). Anything that
consumes them takes them from crates.io and is AGPL-3.0 in effect.

What agentbox still hosts is the estate's **chain instance**, not the crates: the sealed
`sidestr:dreamlab` chain document, the interim producer runner and the mirror sync, all in
[`config/sidechain/`](../../config/sidechain/).

Testnet only. This is experimental software; no real funds are held or moved anywhere.
