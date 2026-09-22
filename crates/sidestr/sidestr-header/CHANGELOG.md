# Changelog

All notable changes to `sidestr-header`. The crate follows semantic versioning.

## 0.2.1 — 2026-09-22

Documentation only; no code change.

- docs.rs builds with all features, so `family` (feature `core`) is documented.
- The crate builds its documentation with `default-features = false`: the
  links to `family`, `Blake2bV2` and `family::Stock` are allowed to dangle
  when `core` is off.
- `missing_docs` is denied, not warned.

## 0.2.0 — 2026-09-22

- Feature `core` (default): `sidestr_core::HeaderFamily` for both header
  types (`Blake2bV2`, `family::Stock`), so `StateOf<Blake2bV2>` validates a
  chain beside `xbt` / `txbt4`; proven by replaying the live
  `sidestr:txbt4-siding` chain (`tests/core_family.rs`).
- The audit counter-examples pinned: a typed v2 genesis judged under the
  Knots overlay's rules, version bit 31 refused on every stock path, a
  mirror's record framing held to its index (`tests/audit_regressions.rs`).

## 0.1.0 — 2026-09-22

- First release: the stock 80-byte and Knots 164-byte v2 headers, their
  proof-of-work hashes, compact targets, the `powLimit` check, the BIP-325
  block data and the fork constants; `no_std`, RustCrypto only.
