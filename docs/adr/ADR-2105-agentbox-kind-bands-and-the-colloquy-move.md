---
id: ADR-2105
title: The agentbox 38xxx bands below 38400 are all reserved, so colloquy and settlement move to 38400-38499
date: 2026-09-21
decision_status: proposed
implementation_status: partial
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit: ab785f08c00b443db44b8b8a6a501b085ce4d0be
verified_paths: [crates/colloquy/colloquy-nostr/src/kinds.rs, docs/PROTOCOL-registry.md, services/nostr-pod-bridge/src/colloquy_publish.rs, agentbox.toml]
owner: jjohare
review_trigger: the next agentbox Nostr kind allocation, or any change to the band table in docs/PROTOCOL-registry.md
repo: agentbox
---

# ADR-2105 — The agentbox 38xxx bands below 38400 are all reserved, so colloquy and settlement move to 38400-38499

## Context

Three records allocate Nostr kinds in the agentbox `38xxx` space and two of them
collide with the first.

- ADR-009 §4.2 and PRD-004 §4.2 reserve `38000`-`38099` for agent intent and
  `38100`-`38199` for agent response. This is not paper: `mcp/nostr-bridge/relay-consumer.js`
  reads the second reservation as a range (`AGENT_RESPONSE_MIN` = 38100,
  `AGENT_RESPONSE_MAX` = 38199) and routes on it.
- ADR-2085 minted colloquy knowledge units at `38100`-`38105`, inside that
  reservation, describing the space as free.
- The settlement pack (ADR-2098, ADR-2101, DDD-022) allocated `38110`
  account binding and `38111`-`38115` domain events from what it called "the
  free `38106`-`38201` range".

`38106`-`38201` was never free. `38100`-`38199` is the agent-response
reservation entire, and `38200`-`38299` is a payment *band* in the host registry
(`VisionFlow/docs/protocol/event-kind-registry.md` §2.3), of which `38200` and
`38201` are merely the two numbers spent so far; `38300`-`38399` is the ADR-021
marketplace band on the same terms. A consumer that reads a range, which the
shipped relay consumer does, cannot tell an agent response from a knowledge unit
or an account binding. The diagram refresh found it; the owner kept ADR-009's
reservation and moved the newcomers.

## Decision

**Every agentbox `38xxx` hundred below `38400` is reserved, so new kinds come
from `38400`-`38499`.** `38000`-`38099` agent intent, `38100`-`38199` agent
response, `38200`-`38299` agent job and payment, `38300`-`38399` LLM marketplace:
four bands, four records, nothing free. `38400`-`38499` is the first hundred no
record reserves; it is agentbox's and recorded as such in both registries. The
older description of agentbox's ownership as "the block `38000`-`38201`" was an
arbitrary cut through two of those bands and is retired.

**Colloquy moves to `38410`-`38415`**, in the minted order: `38410` KnowledgeUnit,
`38411` Confirmation, `38412` Flag, `38413` Supersession, `38414` Graduation,
`38415` ToolGapSignal. ADR-2085 is amended, not rewritten: its Decision names the
new numbers and its Verification keeps the observed `38100` event verbatim.

**The settlement allocations move to `38420`-`38425`**, immediately after
colloquy: `38420` `sidestr-account-binding` (ADR-2098 D2, ADR-2101 D4), then
`38421` PegOutDefaulted, `38422` ChildChainOpened, `38423` ChildChainClosing,
`38424` ChainTombstoned, `38425` SettlementRecorded (DDD-022). They remain
`decision_status: proposed`; only the numbers change.

**Every kind allocation cites the registry row it occupies.** The band table in
[`docs/PROTOCOL-registry.md`](../PROTOCOL-registry.md) is the single source of
truth for what is reserved, spent and free, and each row names the record that
spent it. A number is free only when that table says so. An allocation that
quotes a range instead of a row, which is how both of these collisions were
written, does not comply.

**A kind number is wire, so moving one is a breaking change.** `colloquy-nostr`
and `colloquy-store` go to `0.2.0` on crates.io, and events published under the
old kinds are not migrated: none existed outside the container except the single
`38100` smoke event recorded in ADR-2085, which stays where it is.

## Consequences

- Any consumer pinned to `colloquy-nostr` `0.1` keeps the old kinds and will not
  see `0.2` traffic. The forum client's pin moves to `0.2` in the same change and
  builds against a path patch until the crates are actually published.
- `[sovereign_mesh.relay].allowed_kinds` gains `38410`-`38415`. The old list
  admitted only `38100` of the six, so five colloquy kinds were never actually
  allowlisted; the move fixes that defect as a side effect.
- The `38106`-`38201` phrase is deleted from ADR-2098, DDD-022, INGRESS-identity
  and the registry. The research pack under
  `docs/proposals/sovereign-settlement-research/` keeps it as the record of the
  red-team finding that spotted the internal half of the collision.
- The new band has 10 free numbers below colloquy, 4 between the two allocations
  and 74 above. That is the runway, and the table states it rather than leaving
  the next author to infer it.
- The host registry's §2.3 band table gains the `38400`-`38499` row in the same
  change, so the two repos cannot disagree about what is free. §2.3 is why the
  obvious-looking gap at `38202`-`38299` is not one: agentbox has spent only two
  numbers there, but the host reserves the whole hundred for payment, and a band
  reservation counts even when most of it is unspent.
- Still open: neither allocation is fixture-backed under the ADR-2061 symmetric
  kind-map contract. That merge requirement is unchanged and unmet.

## Verification

- `crates/colloquy/colloquy-nostr/src/kinds.rs` defines `38410`-`38415`; its
  guard test now asserts membership in `38_400..=38_499` and non-membership in
  `38_000..=38_099`, `38_100..=38_199`, `38_200..=38_299`, `38_300..=38_399` and
  `31_400..=31_405`.
  The pre-move test asserted membership in `38_100..=38_201`, encoding the error.
- `cargo test --workspace` in `crates/colloquy`: 8 test binaries, all pass
  (colloquy-nostr 32, colloquy-core 59, colloquy-store 35, colloquy-view 16,
  colloquy-backends 21, colloquy-mcp 23, plus doc tests). `cargo clippy
  --workspace --all-targets -- -D warnings` and `cargo doc --no-deps` are clean.
  `cargo fmt --check` reports pre-existing repo-wide drift in 33 files, unrelated
  to this change and not corrected here.
- `cargo test --manifest-path services/nostr-pod-bridge/Cargo.toml`: all pass.
  `colloquy_publish::SIGNABLE_KINDS` is `38410`, `38411`, `38412`, `38413`,
  `38415`, with `38414` Graduation still refused.
- `grep -rn '3810[0-5]\|3811[0-5]'` over `crates/`, `services/`, `docs/adr/`,
  `docs/proposals/*.md`, `docs/PROTOCOL-registry.md`, `docs/INGRESS-identity.md`
  and `agentbox.toml` returns only the deliberate historical citations in
  ADR-2085's Verification, this record's Context, the crate READMEs' changelogs
  and the frozen research pack.

**Not done, and why.** `colloquy-nostr` `0.2.0` and `colloquy-store` `0.2.0` are
**not published**: `cargo publish` was refused by this session's permission
classifier as a public-surface action, so the version bumps, changelogs and the
forum's `0.2` pins are staged but unreleased. Until they are published, this
record stays `proposed`/`partial` and the forum keeps building against a path
patch rather than the registry. Everything above is verified.
