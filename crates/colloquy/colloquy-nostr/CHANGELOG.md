# Changelog

All notable changes to `colloquy-nostr`. The crate follows semantic versioning.

## 0.2.1 — 2026-09-22

Documentation only; no code change.

- `missing_docs` is denied, not warned.
- Formatted with rustfmt 1.9 (whitespace only).

## 0.2.0 — 2026-09-21

Breaking, wire: the six kinds moved from `38100`–`38105` to `38410`–`38415`,
out of the agent-response range agentbox ADR-009 reserved and into the second
allocation band `38400`–`38499` (agentbox ADR-2105). Nothing else changed; any
event under the old kinds must be republished.

## 0.1.0 — 2026-09-14

- First release: the six kinds, the tag grammar, content-authoritative
  decoding, and ledger reconstruction over authorising principals.
