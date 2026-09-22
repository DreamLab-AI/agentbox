# Changelog

All notable changes to `sidestr-core`. The crate follows semantic versioning.

## 0.2.2 — 2026-09-22

Documentation only; no code change.

- docs.rs builds with `std` and `rpc`, so `parent::rpc` is documented.
  `consensus-oracle` gates no public item and is left out of the docs build.
- The crate builds its documentation without default features: the links to
  `blockfile` and `chain` are allowed to dangle when `std` is off.
- `missing_docs` is denied, not warned.
- The crate docs, `federation` and the README no longer say the co-signing
  round is unported: it is `sidestr-round`.

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
- **A leading UTF-8 byte-order mark changed what a marker named** (audit
  F1). The reference text-decodes markers with a WHATWG `TextDecoder`, whose
  default drops one leading `EF BB BF`; this crate's `from_utf8` kept it, so
  `EF BB BF pegout:abcd` was a recorded 20 000-sat burn there and nothing
  here, `EF BB BF pegout:abcde` was refused there (`sidestr:rule-pegouts`)
  and accepted here, a BOM-led claim was a claim there and a coinbase-amount
  failure here, and the same parent peg-in named the script `abcd` there and
  `efbbbf61626364` here. Every reader the reference text-decodes now drops
  one leading BOM first — `parse_pegout`, `looks_like_pegout`,
  `parse_claims`, the hex-form decision of `parse_peg_marker` (a raw
  remainder keeps every byte, as the reference's `toHex(rest)` does) and
  `record_text` — and nothing else does: the parent peg-out record and the
  checkpoint are compared as bytes in both engines. Pinned in
  `tests/audit_regressions_records.rs`, whose differential holds every
  marker case and every block of the auditor's corpus to identical derived
  lists in both engines (`tests/xcheck.mjs markers|blocks`).
- `op_return_data` documents precisely what it accepts (the reference's
  grammar: a bare length byte whatever opcode it is, `OP_PUSHDATA1` minimal or
  not) and the departure section records why the encoder writes only the
  canonical form. That encoder is unchanged since 0.2.0 — it already wrote
  `OP_PUSHDATA1` above 75 bytes; 0.2.1's code change is burn recognition,
  the burn-loop guard and the BOM handling above.

### Added

- `marker::try_claim_marker` and `marker::try_pegout_marker` (audit F3):
  the checked forms of `claim_marker` and `pegout_marker`, refusing a txid
  that is not 64 lower-hex characters, a `vout` above `CLAIM_VOUT_MAX`
  (99 999: the reference reads five decimal digits, kept), or a parent script
  outside 2 to 40 bytes of hex — the inputs the parsers would not read back.
  The unchecked forms keep their signatures, document their domain, and no
  longer truncate a payload over 255 bytes to a one-byte length: they emit a
  whole `OP_PUSHDATA2` push that no marker parser matches.

Additive API only.

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
