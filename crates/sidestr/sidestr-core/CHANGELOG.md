# Changelog

All notable changes to `sidestr-core`. The crate follows semantic versioning.

## 0.2.1 — 2026-09-22

### Fixed

- **A burn whose marker needs `OP_PUSHDATA1` was silently not recorded.**
  `marker::looks_like_pegout` read the `pegout:` prefix at byte 2, where a
  direct push's data starts; for a parent script of 35 to 40 bytes the marker
  is `6a 4c <len> pegout:…`, byte 2 is the length, and the burn rule
  `continue`d past the output. The reference (`siding/lib/overlay.mjs`
  `sidestr:rule-pegouts`) decodes the push first, so it recorded the burn —
  and refused a block whose `OP_PUSHDATA1` marker starts `pegout:` but does
  not parse, which this crate accepted. Neither engine failed loudly: the
  divergence surfaced as an unpaid burn (and, on the malformed case, a chain
  split). `looks_like_pegout` now follows `op_return_data`, so both push forms
  the reference accepts are recorded and refused alike. Found by running the
  reference as an oracle beside `sidestr-round`; pinned in
  `tests/audit_regressions.rs` with the reference replaying the same block.
- `op_return_data` documents precisely what it accepts (the reference's
  grammar: a bare length byte whatever opcode it is, `OP_PUSHDATA1` minimal or
  not) and the departure section records why the encoder writes only the
  canonical form.

No API change.

## 0.2.0 — 2026-09-22

- Blocks generic over the header family (`HeaderFamily`): stock and, through
  `sidestr-header`, Knots' BLAKE2b v2, proven on a live chain.
- Level 2's pure parts: the federation's challenge, `multi_a` script-path
  verification, partial signatures and `template_id`; the round is not here.
- The parent view (`parent`, `parents`), claims checked against it.
- The five audit counter-examples fixed and pinned (`tests/audit_regressions.rs`).

## 0.1.0 — 2026-09-22

- First release: the chain document, block build/sign, the rules, the block
  file and the validating chain for level 1 beside a stock parent.
