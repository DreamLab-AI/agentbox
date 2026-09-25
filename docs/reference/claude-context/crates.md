# Rust Crate Families — Relocated CLAUDE.md Detail

> Relocated verbatim from `CLAUDE.md` (2026-09-25 always-loaded context cut). The
> binding constraints for each family also live in a lazily loaded `CLAUDE.md` inside
> the crate directory (`crates/colloquy/AGENTS.md`, imported by that directory's `CLAUDE.md`; the sidestr crates moved to `DreamLab-AI/sidestr-rs`, ADR-2112), which
> Claude Code reads only when working there.

## colloquy — [`crates/colloquy/`](../../../crates/colloquy/)

The cq shared-agent-learning model, clean-room in Rust (ADR-2085/2086). Six crates:
[`colloquy-core`](https://crates.io/crates/colloquy-core) (the standard — pure,
wasm-capable, Apache-2.0, **published**),
[`colloquy-view`](https://crates.io/crates/colloquy-view) (presentation models; depends on
core alone, which is why the forum takes both from crates.io and has **no path edge into
this repo**), [`colloquy-nostr`](https://crates.io/crates/colloquy-nostr) (kinds
38410–38415, moved from 38100–38105 by ADR-2105; owns the NIP-01 structs, so it is
**published** and carries no Nostr-library coupling),
[`colloquy-store`](https://crates.io/crates/colloquy-store) (local / shared / relay behind
one trait, transports as traits, **published**; **no sixth adapter slot**),
`colloquy-backends` (the production transports — the governed `ruvector-mcp.cjs` as a
child process and a websocket to the relay; **internal**: it is the only crate still bound
to this estate's `nostr-bbs-core` signing and to that specific server, so it is not
reusable elsewhere), and `colloquy-mcp` (**internal**, a binary: the six verbs —
`query`/`propose`/`confirm`/`flag`/`reflect`/`status` — over stdio, tier chosen by
`COLLOQUY_TIER`). Confidence counts **authorising principals**, never accounts: an
operator's fifty agents are one voice, and an unregistered pubkey is dropped rather than
self-authorising. It **replaced** `precedent-service.js`/`precedent-bridge.js`, now
deleted: the `governance-precedents` namespace was empty and nothing called the tools, so
there was no migration to keep revertible.

## sidestr — moved to [`DreamLab-AI/sidestr-rs`](https://github.com/DreamLab-AI/sidestr-rs) (ADR-2112)

> Historical description kept for context; source, CI and releases now live in sidestr-rs and
> `crates/sidestr/README.md` is only a pointer. This repo hosts the chain instance (`config/sidechain/`).

The sidestr sidechain stack in Rust (PRD-024, ADR-2096/2106), five crates **published**
(core/header/nostr/wallet at 0.2.x, round at 0.1.0) and **`AGPL-3.0-only`** — attributed
ports of Melvin Carvalho's `siding` (plus the schema kernel and blaketestnode), never
dual-licensed, never a dependency of a permissive crate:
[`sidestr-header`](https://crates.io/crates/sidestr-header) (both header families,
no_std, RustCrypto only), [`sidestr-core`](https://crates.io/crates/sidestr-core) (chain
document, block build/sign, rules, block file, validating chain; level 1 and the stock
family in 0.1, fails closed to taproot key-path),
[`sidestr-nostr`](https://crates.io/crates/sidestr-nostr) (own NIP-01 event, a sealed
`SignRequest` so only named `sign_*` operations reach a key, kinds
33333/23500/23501/33500-33502/23510-23514 and the estate's 38420-38425),
[`sidestr-wallet`](https://crates.io/crates/sidestr-wallet) (coins, selection, key-path
spends, burns, peg-in shape behind `SpendSigner`/`SpendPolicy` ports). Every crate is
proven against the JS reference as oracle (byte-identical genesis, two-way block interop,
spends mined by both engines) and gated by `.github/workflows/sidestr-crates.yml`. The
consensus round for level 2 is **not** in core: it is
[`sidestr-round`](https://crates.io/crates/sidestr-round) (0.1.0, upstream's wire
protocol, availability-tolerant; the `cosign` binary joins a federation and co-signs with
the JS signers live; one journal file per round, one writer per file), with the BFT
redesign of ADR-2101's consultant review a later crate. Every release is audited anti-fox
before publish (GPT-6 Astra via the codex CLI, neutral verification-engineering wording —
adversarial wording trips the content filter); findings become
`tests/audit_regressions*.rs`. The sealed root chain and its interim producer:
[`config/sidechain/`](../../../config/sidechain/).
