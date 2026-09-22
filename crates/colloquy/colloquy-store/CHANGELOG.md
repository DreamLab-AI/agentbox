# Changelog

All notable changes to `colloquy-store`. The crate follows semantic versioning.

## 0.2.1 — 2026-09-22

Documentation only; no code change.

- `missing_docs` is denied, not warned.
- Formatted with rustfmt 1.9 (whitespace only).

## 0.2.0 — 2026-09-21

Breaking, wire: follows `colloquy-nostr` 0.2 — the relay store's kinds moved
from `38100`–`38105` to `38410`–`38415` (agentbox ADR-2105). The
`KnowledgeStore` trait and every local/shared behaviour are unchanged.

## 0.1.0 — 2026-09-14

- First release: one `KnowledgeStore` contract over the local file, shared
  vector memory and a Nostr relay, with transports as traits.
