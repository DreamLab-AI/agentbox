# Changelog

All notable changes to the prose-sanitiser workspace.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

The hardening pass ahead of a crates.io publication. Driven by the design brief
of 2026-09-03, which reset four assumptions the original Python tool was written
under: Claude's own text has been watermarked since 2 August 2026, no major LLM
has a verified vendor Unicode watermark, the strongest Unicode carrier is now the
variation-selector chain, and the UK-English rule was a single unsafe regex.

### Changed

- **Corrected the provenance claims.** Three statements in the skill and its
  reference material were withdrawn rather than softened, because publishing
  them would have been a false claim:
  1. "Statistical sampling fingerprints" as something the tool strips. It cannot,
     and no third party can without the vendor key. Restated: paraphrase degrades
     a sampling watermark as a side effect of changing tokens, which is lossy and
     unverifiable.
  2. "Proving the mark was cleared in a closed loop." The MarkLLM harness proves
     a *self-applied* mark with a *known key* was cleared. It says nothing about
     a vendor's production watermark.
  3. Pixel-domain watermark removal as a capability. It is an external GPU
     dependency, it is now itself detectable at over 98 per cent TPR at 1 per
     cent FPR, and stripping a container manifest does not defeat a durable
     Content Credential anyway.
- Replaced the capability language everywhere with the four-block honest matrix:
  strips losslessly and verifiably; detects and reports only; degrades but never
  removes; never touches. It appears in the workspace README, every crate README,
  every crate-level `//!` doc, and the skill.
- Split severity from confidence throughout. Severity rates impact; confidence
  rates whether the rule is right, and only confidence gates a fix.

### Added

- `ConfidenceTier` with three levels, and the write policy built on it:
  `certain-mechanical` auto-fixes and is verifiable by diff,
  `high-confidence-stylistic` applies only under `--write`, and
  `low-confidence-judgement` is never applied under any configuration.
- Skill references `uk-english.md` and `unicode.md`, covering the VarCon
  subsystem and the Unicode carrier taxonomy respectively.
- Workspace `README.md` and this changelog.
- Per-crate publishing checklists for the four publication candidates.

### Added

Landed on `rust/prose-sanitiser-hardening` during the 2026-09-03 hardening pass.

- **UK English rebuilt as a real subsystem.** VarCon 2020.12.07 vendored
  (licence cleared, hash-pinned and attributed in `crates/uk/data/`), with the
  `B` against `Z` tags driving an Oxford `-ize` mode. Span exclusion runs first
  (code, links, front matter, quotations, names, non-English via a `whatlang`
  pre-filter), then VarCon lookup, then sense resolution, then a `Finding` whose
  confidence tier gates any fix. Two rule ids, because the tiers are genuinely
  different findings: `us-spelling` (unconditional, fixable under `--write`) and
  `us-spelling-sense` (report-only, forever). `check_and_fix` fixes *the color*
  to *the colour* while leaving *the gas meter* alone, which is the whole design
  in one assertion.
- **UTS #39 properly**, via `unicode-security`, replacing the 40-entry
  hand-written confusables table; and a bidi policy split by context, rejecting
  every control in source code (Trojan Source, CVE-2021-42574) while preserving
  balanced controls in genuine RTL prose.
- **Variation-selector, tag-block and zero-width payload decoding**, so a
  finding reports what was hidden rather than silently deleting it. This is the
  live steganography vector, used in the real *os-info-checker-es6* npm
  supply-chain attack. `stego::scan` returns the recovered bytes with the base
  character and a note on why the run was judged a payload.
- **Two views of the Layer A surface**: `inspect_text`/`clean_text` count
  codepoints for an audit sweep, `check_text`/`check_prose` return `Finding`s
  with byte spans for a SARIF exporter, an LSP or a `fix()` pass.
- **Hand-rolled container parsing replaced by maintained crates**, and every
  subprocess removed from the implementation path: `img-parts` for JPEG segments
  and PNG/RIFF chunks, `lopdf` for the PDF object graph (its full rewrite on
  save is what `qpdf --linearize` used to provide), `zip` and `quick-xml` for
  OOXML and ODF. The `c2pa` SDK stays read-and-validate only, because its
  removal API is internal; stripping is container surgery. `qpdf` is gone
  entirely, and `exiftool`/`c2patool` survive only as an advisory cross-check
  behind a non-default `external-verify` feature.
- **Lossless surgery now asserted, not asserted-to**: SHA-256 byte-exact round
  trips, pixel-exact image comparison after a metadata strip (with the
  compressed `IDAT` and entropy-coded scan checked as carried across verbatim),
  OOXML compression-method and entry-order preservation, and a PDF incremental
  update leaving no recoverable original `/Info` in the byte stream. Fixtures
  are generated in-process, so the suite is hermetic.
- **One output flag**, `--format {text,json,jsonl,sarif}`, with `--json` kept as
  an alias; SARIF 2.1.0 for GitHub code scanning; and the exit-code contract
  0 clean, 1 findings reported, 2 tool error, printed in every binary's `--help`
  epilogue.
- **Vale-style suppression** (`<!-- prose-sanitiser off -->` / `on`, and
  `<!-- prose-sanitiser:ignore RULE -->`), a committed `.prose-sanitiser.toml`
  discovered by walking up from the target, `--disable RULE`, and
  `--explain-rules` to print the rule table with its tiers, dates and sources so
  a decayed lexical rule is visible rather than silent.

### Still open

- The `sanitise` umbrella pass is declared in `crates/cli/src/lib.rs` but has no
  module file yet.
- No published false-positive rate on British English. Until the UK human-prose
  corpus exists, the sense-dependent half of the UK layer is advice, not
  correction, and the tier system is what enforces that.

## [0.1.0] - 2026-09-03

The Rust port and the workspace split.

### Added

- **Ported the Python skill to Rust** across four commits: the crate skeleton
  and Layer A Unicode port, image and container metadata surgery, dispatch plus
  the audit sweeps and two slop scanners, then the Layer B rewrite, the HTTP
  service and the CLI binaries. 294 tests at the point of merge.
  - The provenance binaries began as
    [watermarks-remover](https://github.com/guillaumemeyer/watermarks-remover)
    (MIT). The CLI surface and output shape were kept unchanged.
  - `open-design`'s `slop-detect.py` was retired in favour of the Rust
    `slop-detect`, fixing two parity bugs found in the process.
- **Split the single crate into a seven-member Cargo workspace** for licence and
  dependency hygiene. `core`, `unicode`, `uk` and `slop` are pure Rust with no
  C dependencies, no filesystem access and no subprocesses, which is the part
  worth publishing; `media` carries the heavier tree; `cli` and `server` are the
  deployment surfaces.
  - `core` gained `Finding`, `Span`, `Edit`, `Patch`, `Config`, `Severity`
    (moved from `slop`), `ConfidenceTier`, and the `Check`/`Fix` traits.
  - `uk` was created to own the US-spelling pattern as a single source of truth,
    so the scanner and the library API cannot drift.
  - `cli` keeps a `common` facade re-exporting `core` plus the `media` I/O and
    process helpers, so every existing import path and all 12 binary names were
    unchanged by the split.
- The skill cut over from Python to the baked binaries. The only Python left is
  the four optional torch harnesses, which wrap model stacks that exist only in
  Python.

### Notes

- Published nowhere yet. Version 0.1.0 is the workspace's internal starting
  point, not a release.
- The Nix packaging comments were updated but not verified by an actual `nix
  build`, since nix is absent from the development container. That needs a host
  rebuild.

## Earlier

Before the Rust port, prose-sanitiser was a Python skill. The rule catalogue it
accumulated is still the substance of the skill's reference sections, and its
history is in the agentbox repository root `CHANGELOG.md`. The rules added
closest to the port: the `The <lowercase>` opener rule and `.tex` support
(2026-08-24), the B14 insider-voice rule for audience leakage in external
documents (2026-08-26), the B15 preamble-setup-label rule (2026-08-26), and the
substance-first editorial workflows adapted from Addy Osmani's
[clarity](https://github.com/addyosmani/clarity) (2026-09-01).
