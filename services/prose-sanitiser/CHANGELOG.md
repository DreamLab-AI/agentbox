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
- **Licence settled: `MIT OR Apache-2.0`.** ADR-2030 (2026-09-03, accepted)
  records that crates under `services/` are permissive per crate while the
  containing repository stays AGPL-3.0-only. That is not a contradiction: the
  AGPL governs the aggregate hosted service, not the licence of each part, and
  the grant travels with the crate to crates.io. ADR-2030 amends ADR-016's
  uniformly-AGPL statement for `services/`, so the conflict three workers and
  the adversarial review (finding 9) flagged is closed rather than worked
  around. `LICENSE-MIT` and `LICENSE-APACHE` sit at the workspace root and are
  linked into every crate. One condition rides with it: a `services/` crate that
  links an AGPL library is not permissive in effect and must declare
  `AGPL-3.0-only` instead of advertising a grant it cannot give. Nothing in this
  workspace does, and adding such a dependency would be a licence change needing
  ADR-2030 re-reviewed.
- **Documentation scope, from the same review (finding 10).** "Lossless" and
  "never touches pixels" now name the path they describe: a container-only
  operation that succeeds, with pixel removal disabled. `clean-image
  --remove-pixel` hands the file to a diffusion harness that rewrites pixels by
  design, so it sits outside both claims. A clean `inspect-*` is now stated as
  evidence that no known embedded carrier remains, not as proof of anonymity or
  of complete provenance removal.
- Split severity from confidence throughout. Severity rates impact; confidence
  rates whether the rule is right, and only confidence gates a fix.
- **The soft hyphen moved out of the mechanical tier.** `U+00AD` was stripped
  unconditionally, which was wrong in both directions: it silently removed
  legitimate hyphenation from compound words, and it dressed a judgement about
  the author's intent as a mechanical certainty. It is now preserved by default,
  reported as `unicode-soft-hyphen` at `low-confidence-judgement`, and stripped
  only through `CleanOptions::strip_soft_hyphen`. It is the only rule in the
  Unicode layer that is not `certain-mechanical`, and the capability matrix in
  the skill, the workspace README and `references/unicode.md` all moved it from
  the strips-losslessly block to never-touch.

- **UK exclusions are a CommonMark parse, not a regex.** `prose-sanitiser-uk`
  now locates code spans, code blocks and link destinations with
  `pulldown-cmark` (MIT). The regex pass it replaces paired backticks by run
  length within a line, ignored four-space indented code entirely, and
  recognised a link only by its scheme, so `[color](relative/path/color)` had
  its destination rewritten by `--write`. Five classes of span are now
  protected: straight and curly single quotations, indented code blocks,
  relative and reference link destinations, and bare file paths. Link *text*
  stays checked, because it is prose a reader reads, and a slash alone still
  does not make a path — `color/center` and `and/or` are English, not
  filenames. Each class is asserted twice: once that no finding is raised, and
  once that a `--write` pass returns the bytes unchanged.
- **The *practice/practise* noun reading is silent by default.** On 2,000
  documents of British human prose, `practice` and `practices` were 146 of 218
  `us-spelling-sense` findings, every one a false positive. The disambiguator
  now reads the token directly in front of the word before the wider window —
  a modifier in front outranks a copula three tokens back, which is what made
  *this is standard practice* resolve as a verb — and assumes the noun for an
  `<N>`/`<V>` pair whose noun sense is already correct British English. That
  gate admits *practice*, *practices*, *draft* and *drafts* and nothing else, so
  *licence* and *programme* keep reporting. `us-spelling-sense` fell from 218
  findings to 79, and `practice` from 111 to 7. What it gives up is a bare verb
  use with no marker in front of it, *doctors practice medicine*; the rule is
  report-only either way.
- **Fixability is declared by the crate that owns the rule.** `Fixability`
  defaults to what the confidence tier implies, and for high-confidence
  stylistic rules that default is `OptIn` — correct for a rule that can offer
  a replacement, and no rule in `prose-sanitiser-slop` can. On the same 2,000
  documents that mislabelled 566 findings as write-eligible across `agg` and
  `negative-parallelism`, both of which are whole-document density observations
  with a zero-length span at offset 0 and nothing to substitute into. Nothing
  was ever rewritten, because a finding with no replacement yields no edit, but
  the label was a promise the tables could not keep. Every rule table now
  carries a `FIXABILITY` constant beside its `RULES`;
  `sanitise::fixability_table()` concatenates them, `Report::with_fixability_table`
  carries them into the SARIF driver rules, and a workspace test asserts the
  invariant in both directions. Write exposure on that corpus is now 116 edits
  from 116 write-eligible findings, all `us-spelling`, down from 683.
- `slop-scan`'s JSON Lines and SARIF output carries the `replacement` the
  delegated UK rule offers. It reported `replacement: null` on every finding
  while labelling `us-spelling` opt-in, which told a consumer two different
  things about the same finding.

### Added

- `ConfidenceTier` with three levels, and the write policy built on it:
  `certain-mechanical` auto-fixes and is verifiable by diff,
  `high-confidence-stylistic` applies only under `--write`, and
  `low-confidence-judgement` is never applied under any configuration.
- Skill references `uk-english.md` and `unicode.md`, covering the VarCon
  subsystem and the Unicode carrier taxonomy respectively.
- Workspace `README.md` and this changelog.
- Per-crate publishing checklists for the four publication candidates.

Landed on `rust/prose-sanitiser-hardening` during the same pass:

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

- **Detection and mutation are separate switches on every rule.** `report_spaces`
  had been doing double duty, deciding both whether a whitespace finding existed
  *and* whether it carried a rewrite, so "tell me about the non-breaking space
  but do not touch it" was not a position the policy could express. For `U+202F`,
  the one whitespace character that is a documented GPT-4o-class provenance tell,
  that was backwards. `report_spaces` is now detection only and unconditional; a
  separate `normalize_spaces` gates the replacement, the way `fold_homoglyphs`
  already gated the fold. No default behaviour changed. It is the same shape of
  bug as the three cross-surface divergences: two things that must vary
  independently, tied to one switch.
- **`check_text` is now a truthful preview of `clean_text`.** The two surfaces
  disagreed three times over: bidi controls that the check declined to offer but
  the cleaner stripped anyway; homoglyphs the check offered to fold, at default
  settings, that the cleaner refused to touch; and non-breaking spaces the
  cleaner rewrote by default while the check never mentioned them. `TextPolicy`
  now mirrors `CleanOptions` field for field, defaults included, and a single
  invariant asserts that applying the edits `check_text` offers reproduces
  `clean_text`'s output exactly, over eight samples against three policy
  pairings. Any future divergence in either direction fails immediately.
- **`sanitise`**, the umbrella pass: every layer over a file or tree on one
  confidence scale, with `--fix` for `certain-mechanical`, `--write` for that
  plus `high-confidence-stylistic` (implying `--fix`), and `--diff` to preview.
  It reports image and container provenance but never rewrites those bytes,
  which stays with `clean-image` and `clean-file`.

- **A third axis, `Fixability`** (`Mechanical`, `OptIn`, `ReportOnly`,
  `NoFixExists`), orthogonal to severity and confidence. It derives from the
  tier by default, so a rule declares it only when it differs. The case that
  forced it: `media-c2pa-soft-binding` is a certain detection with no possible
  fix, because the watermark is in the pixels. Filing it as a low-confidence
  judgement to keep it from being auto-fixed made the crate's strongest evidence
  wear its weakest label, in the field a reader uses to decide how far to trust
  a detection. It now reads as what it is: certain, and unfixable.
- **No degraded PDF mode.** A file `lopdf` cannot parse is refused with nothing
  written, rather than falling back to raw-byte surgery that leaves offsets
  broken or copies the metadata through intact. Every rewrite is reparsed and
  checked for residual `/Info`, `/Metadata`, XMP packets and C2PA manifests
  before it reaches the disk. A clean that cannot be verified is a failed clean.
- **A reported payload is a removed payload.** Detection and cleaning were
  independent passes, so a carrier the inspector named could survive the
  cleaner. They are now tied by the preview invariant.
- **An APP11 segment is no longer assumed to be C2PA.** It is a general JPEG XT
  and JUMBF carrier, so the reassembled box's `jumd` type UUID and label decide,
  and a non-C2PA box survives unless a full strip was requested.

- **`--normalize-spaces` is the opt-in**, on `clean-text` and `sanitise`, with
  the old `--no-normalize-spaces` kept as a hidden no-op that prints a note. The
  library, the binaries and `sanitise` now agree that exotic whitespace is
  preserved by default; for a while they did not.
  - **Breaking, for the bare invocation.** `clean-text` with no flags used to
    fold `U+00A0` to a space and now preserves it. Anything that piped text
    through bare `clean-text` and depended on the fold needs `--normalize-spaces`
    to restore the old output. Passing `--no-normalize-spaces` always meant
    preserve, so those invocations are unaffected.
- **Fixability travels with the finding.** `Config::with_fixability_table`
  applies a side table of rules whose repairability does not follow their tier;
  `sanitise::FIXABILITY_OVERRIDES` holds the one entry. SARIF results carry
  `properties.fixability` and `properties.autoFixable`, and a finding with no
  possible repair also carries `properties.noFixExplanation`, because "we will
  not repair this for you" and "this cannot be repaired by anyone" are different
  messages and only the tier used to be visible.

### Measured

The capability matrix stopped being a claim and started being a number.

- Homoglyph detection on the SilverSpeak fixtures at 5, 10 and 20 per cent
  substitution: precision 1.0000, recall 1.0000. Legitimate-Unicode controls
  (emoji ZWJ, Devanagari, Persian, Hebrew-Latin, BOM, subdivision flags) produce
  zero strips and round-trip byte-identical.
- Container surgery: SHA-256 byte-identical round trips, pixel-exact images with
  the compressed `IDAT` and entropy-coded scan carried across verbatim, OOXML
  compression and entry order preserved, and no recoverable `/Info` left by a
  PDF incremental update.
- UK English on 2,000 British documents and 1.2 million words (Hansard, GOV.UK,
  Project Gutenberg): `us-spelling` flags 5.60 per cent of documents (0.097 per
  1,000 words) and `us-spelling-sense` 8.15 per cent, with **zero auto-fixed in
  both**. Every finding on that corpus is a false positive by construction, so
  the worst case on British prose is noise in a report rather than a corrupted
  document. The 5.60 per cent is an upper bound, since a Hansard debate quoting
  an American witness contains genuine American spellings. Roughly one flagged
  document in eighteen, against the 61.3 per cent false-positive rate seven
  commercial detectors showed on TOEFL essays (Liang et al. 2023, *Patterns*).
  No published study measured detector or linter false positives on British
  English before this.

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
