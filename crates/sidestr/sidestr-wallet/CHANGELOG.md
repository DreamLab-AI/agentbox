# Changelog

All notable changes to `sidestr-wallet`. The crate follows semantic versioning.

## 0.2.2 — 2026-09-22

Documentation only; no code change.

- docs.rs builds with all features, so the `client` HTTP calls in `deliver`
  are documented.
- `missing_docs` is denied, not warned.
- The README's dependency lines are 0.2's; the relay client and the peg-out
  round are named as `sidestr-round`'s.

## 0.2.1 — 2026-09-22

- Parent records are bounded before they are built (audit F4):
  `pegin::pegout_payment_outputs` returns `Error::MarkerTooLong` past the
  parent's 80-byte `OP_RETURN` policy or the marker grammar's one length
  byte, rather than an output no parser reads back.

## 0.2.0 — 2026-09-22

- Follows `sidestr-core` 0.2: the coin fold and the spend builders over the
  generic state; the parent-side peg-in, peg-out payment and checkpoint
  shapes (`pegin`); `SpendPolicy` consulted by every builder.

## 0.1.0 — 2026-09-22

- First release: coins, largest-first selection, taproot key-path spends and
  peg-out burns behind `SpendSigner`, delivery as a `POST /tx` body or a
  kind-23500 template, HTTP behind feature `client`.
