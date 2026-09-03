# prose-sanitiser-uk

Sense-aware UK-English spelling enforcement for Rust.

British English is not American English with a lookup table applied. Roughly
half of the interesting cases are not dialect questions at all, and a flat
find-and-replace gets every one of them wrong:

| Correct British English | Why a naive rule breaks it |
|---|---|
| a driving **licence**, to **license** a doctor | Noun/verb split *inside* British English |
| the gas **meter**, twelve **metres** | The instrument keeps `-er`; only the SI unit takes `-re` |
| the computer **program**, the television **programme** | Computing keeps the short form |
| **sulfur** dioxide | RSC adopted the IUPAC spelling in 1992; BSI followed in 1993 |
| the **fetus** | Standard in UK biomedical usage (92.5% of UK-indexed papers) |
| the **dialog** box | A widget, not a conversation |
| World Health **Organization** | That is its name |

This crate is built so it cannot make those mistakes.

## How it works

```text
document
   -> span exclusion      code, links, front matter, quotations, paths, names
   -> language filter     Config::language, shared with every other checker
   -> VarCon lookup       is this really an American spelling?
   -> sense resolution    which meaning, and is it already correct?
   -> suppressions        Config::suppressions, Vale-style HTML comments
   -> Finding             with a confidence tier that gates any fix
```

```rust
use prose_sanitiser_core::{Check, Config};
use prose_sanitiser_uk::UkEnglish;

let checker = UkEnglish::new();
let config = Config::new();

let findings = checker.check("We optimize the color scheme.", &config);
let fixes: Vec<_> = findings.iter().filter_map(|f| f.replacement.as_deref()).collect();
assert_eq!(fixes, ["optimise", "colour"]);

// Oxford spelling keeps -ize, but never -yse.
let oxford = Config::new().with_oxford(true);
assert!(checker.check("We optimize it.", &oxford).is_empty());
assert_eq!(checker.check("We analyze it.", &oxford).len(), 1);

// None of the traps fire.
assert!(checker.check("The gas meter read 12 metres.", &config).is_empty());
assert!(checker.check("A permit to license a doctor.", &config).is_empty());
assert!(checker.check("Set `color: red` in the stylesheet.", &config).is_empty());
```

## Confidence, and what may be changed automatically

| Finding | Tier | Auto-fix |
|---|---|---|
| Unconditional pair (`color` -> `colour`) | `HighConfidenceStylistic` | Only behind `Config::write` |
| Sense-dependent pair (`license`, `meter`, `program`) | `LowConfidenceJudgement` | **Never** |

Nothing this crate produces is `CertainMechanical`. Spelling is a style
question, and a style question is never certain. `check()` never mutates;
`fix()` returns a `Patch` that describes the change and leaves applying it to
the caller.

`us-spelling` is the only rule in the workspace a `--write` run applies to
prose. That is deliberate and it is the whole exposure: `us-spelling-sense`
carries no replacement, and every other text rule in the workspace is
report-only. See [Write exposure](#write-exposure) for the measurement.

## House style

Two escape hatches, because every project has vocabulary a dictionary will not
settle:

```rust
use prose_sanitiser_uk::{UkEnglish, UkOptions};

let checker = UkEnglish::with_options(
    UkOptions::new()
        // Names that keep an American spelling because it is their name.
        .with_organisations(["Wilson Color Labs"])
        // Terms of art that are not really a dialect choice.
        .with_allowed_words(["artifact", "rumor", "distill"]),
);
```

The gazetteer is matched case-sensitively and whole, so it protects the name
without protecting the word elsewhere. The word allowlist is case-insensitive
and silences both rules. Exclusions for code, links, front matter, quotations
and proper nouns can each be switched off individually, though the defaults
exist because each one stops a specific class of wrong finding.

The language pre-filter and the Vale-style suppression comments
(`<!-- prose-sanitiser-disable us-spelling -->`) are not options here: they live
on the shared `Config` (`without_language_filter()`, `with_suppressions(false)`)
so one setting governs every checker in the workspace.

## Data provenance

The dialect data is [VarCon](https://wordlist.aspell.net/varcon-readme/)
2020.12.07 by Kevin Atkinson and Benjamin Titze, part of the SCOWL project,
vendored verbatim at `data/varcon.txt`. Provenance, upstream URL, SHA-256 and
the full licence are in [`data/LICENSE-VarCon`](data/LICENSE-VarCon). The notice
is permissive and MIT/BSD-equivalent with no copyleft, which is what allows it
inside a crate published as `MIT OR Apache-2.0`.

Deliberately **not** used: en_GB Hunspell dictionaries as shipped by
LibreOffice (GPL-2.0 / LGPL-2.1 / MPL-1.1 tri-licensed) and LanguageTool's rule
set (LGPL). SCOWL/VarCon is the clean-licence source, and is the same route
Mozilla took in 2007 when it re-derived its dictionaries.

### The generator

[`build.rs`](build.rs) compiles `varcon.txt` into a sorted, binary-searchable
table in `$OUT_DIR`. The data file is never read at run time. Three things fall
out of VarCon's own structure rather than out of a hand-written exception list:

- **The Oxford split.** VarCon tags British `-ise` as category `B` and British
  `-ize` (Oxford) as `Z`. `A Z: organize / B: organise` says Oxford keeps
  *organize*. `A C: analyze / B Cv: analyse` carries no `Z` tag at all, and the
  format's rule that "`B` implies `Z` when the line has no `Z`" makes *analyse*
  correct in both modes. That is the `-yse` rule, derived.
- **The sense-dependent set.** VarCon splits a cluster into groups when spelling
  depends on usage, tagging them `<N>`/`<V>` or with a gloss. A word whose
  groups disagree is marked ambiguous and can never be auto-fixed. All eight
  named pairs come from this, plus draft/draught, analog/analogue and
  micrometer/micrometre.
- **The technical-register traps.** `A Bv: sulfur / B: sulphur` marks *sulfur*
  an accepted British variant, so it produces no table entry and cannot be
  "corrected".

The generator drops entries that would cause more harm than good: American
*variant* spellings such as *dialog* (tagged `AV`, seldom used), proper nouns
and taxonomic names, replacement targets that are proper nouns, and short words
outside the common-word levels, where VarCon's tail holds unverified morpheme
fragments (`A: et / B: aet`) that would fire on "et al.".

The hand-verified always-`ise` and always-`yse` lists in `src/overrides.rs`
duplicate what the data already says. They are kept as a guarantee rather than a
mechanism: cross-check tests fail the build if a future data revision ever
disagrees with them.

## Measuring it

The only interesting number for a linter is how often it is wrong. Run the
report over a corpus of known-good British prose and every finding is, by
construction, a false positive:

```sh
cargo run -p prose-sanitiser-uk --example uk-report -- \
    [--oxford] [--verbose] [--write] [--allow WORD]... <path>...
```

### Measured

Two corpora, September 2026.

**The D3 UK prose set** (the sentences that broke the previous implementation:
*World Health Organization*, *a driving licence*, *to license a doctor*, *the
gas meter read 12 metres*, *the computer program*, *sulfur dioxide*, *the
dialog box*) produces **zero findings** in both `-ise` and Oxford mode. Not
merely zero auto-fixes: complete silence.

**413,746 words of British technical documentation**, with three house terms
declared (`artifact`, `rumor`, `distill`, all domain vocabulary rather than
dialect choices):

```text
documents: 242
words: 413746
findings: 118 (64 fixable)

rule                      findings  fixable   per 10k words
us-spelling                     64       64            1.55
us-spelling-sense               54        0            1.31
```

All 64 spelling findings were inspected by hand and every one is a genuine
Americanism (*behavior*, *math*, *initialize*, *defense*, *catalog*,
*neighbors*, *modeled*, *dialing*): a **false-positive rate of 0 out of 64**.
The 54 sense findings are judgement calls on *program* and *license* in a
technical register, reported at low confidence and never auto-fixed.

For comparison, before the sense prior and the `--allow` list the same corpus
produced 457 findings. The `verify` prior for *check* alone removed 210.

### 2,000 documents of British human prose (2026-09-03)

1,206,061 words of GOV.UK publications (436 documents), Hansard debates (964)
and Project Gutenberg British literature (600), every one human-written and
pre-2022. Measured with `ps-eval run`; the report is
`uk-exclusions-2026-09-03.md` in the evaluation workspace. Every finding on this
corpus is a false positive.

| Rule | Documents flagged | Findings | Per 1k words | Before | Change |
|---|---:|---:|---:|---:|---|
| `us-spelling` | 111 (5.55%) | 116 | 0.10 | 117 | -1 |
| `us-spelling-sense` | 71 (3.55%) | 79 | 0.07 | 218 | **-64%** |

The `us-spelling-sense` fall is the *practice/practise* tuning. Before it,
`practice` and `practices` were 146 of the 218 findings: two thirds of the
rule's output on this corpus, and every one wrong, because British English
spells the noun *practice* and the noun is what almost all of them were. The
disambiguator now reads the token directly in front of the word before it reads
the wider window, and assumes the noun for a `<N>`/`<V>` pair whose noun sense
is already correct British English. `practice` fell from 111 findings to 7 and
`practices` from 35 to none.

What that gives up is a bare verb use with no marker in front of it, as in
*doctors practice medicine*, which now passes silently. The rule is report-only either way, so
the trade is 139 reports a reader must dismiss against one they will not see.
A verb marker, a modal, an adverb, `to`, or the inflected *practiced* and
*practicing* all still report; the last two are unconditional and carry a
replacement.

The `us-spelling` fall is small because Hansard and Gutenberg prose contains
almost no Markdown. The exclusion work below is worth far more on documentation
than it is here.

### Write exposure

What matters for a `--write` run is not how many findings there are but how
many would change bytes. On the corpus above:

```text
write-eligible findings   116   (mechanical or opt-in)
edits a --write applies   116   (write-eligible and carrying a replacement)
rules involved            us-spelling
```

Before 2026-09-03 the same corpus reported **683 write-eligible findings**
across `agg`, `negative-parallelism` and `us-spelling`. The 566 in the first two
were mislabelled: neither rule can produce a replacement, so none of them could
ever have been applied. They are declared `ReportOnly` now, and the two columns
agree, which is the property worth having: a gap between them means a rule is
claiming a repair it does not have.

### Exclusions (2026-09-03)

Code spans, code blocks and link destinations are located by a CommonMark parse
(`pulldown-cmark`) rather than by regex. Five classes of span that the regex
pass rewrote are now protected, each asserted twice. Once that no finding is
raised, and once that a `--write` pass returns the bytes unchanged:

| Span | Probe | Before |
|---|---|---|
| Straight single quotes | `He said 'The color is red.'` | rewritten |
| Curly single quotes | `He said ‘The color is red.’` | rewritten |
| Indented code blocks | four-space indented `color: red` | rewritten |
| Relative link destinations | `[text](relative/path/color)` | rewritten |
| Bare file paths | `./docs/color/theater.md` | rewritten |

Two lines are held deliberately. Link *text* is prose and stays checked, because
it is what a reader reads. And a slash alone does not make a path: `color/center`
and `and/or` stay checked, because treating every slashed pair as a filename
would silence a real class of finding to catch a rare one.

## Scope

This crate enforces a house style. It does not detect authorship, and a
document that passes it is not thereby proved to be anything. It does not
attempt grammar either: [`harper-core`](https://lib.rs/crates/harper-core)
already does that well.

## Licence

**MIT OR Apache-2.0**, at your option. Vendored VarCon data keeps its own
permissive notice; see [`data/LICENSE-VarCon`](data/LICENSE-VarCon).

Per [ADR-2030](../../../../docs/adr/ADR-2030-permissive-licensing-for-publishable-service-crates.md), crates under `services/` are
permissive per crate while the containing repository stays AGPL-3.0-only.
That is not a contradiction: the AGPL governs the aggregate hosted service,
not the licence of each part, and this grant travels with the crate.
## Publishing checklist

Publication candidate. Before `cargo publish`:

- [x] **Licence position settled.** `MIT OR Apache-2.0` per ADR-2030
      (2026-09-03, accepted): `services/` crates are permissive per crate, the
      containing repository stays AGPL-3.0-only, and the grant travels with the
      crate. `LICENSE-MIT` and `LICENSE-APACHE` present and linked
- [x] `description`, `repository`, `keywords`, `categories`, `readme` set
- [x] Vendored data licence-cleared, attributed and hash-pinned in `data/`
- [x] Pure Rust: no C dependencies, no subprocesses, no network
- [x] Packaging keeps `data/` in the published `.crate`, since `Cargo.toml` uses
      `exclude` (dropping `corpora/`) rather than an `include` allowlist
- [x] Crate-level `//!` docs stating the honest scope
- [x] `cargo package --list` confirms `data/varcon.txt`,
      `data/varcon.txt.sha256` and `data/LICENSE-VarCon` are present (30 files),
      and that `corpora/` is not
- [x] `cargo doc --no-deps` clean, with no warnings
- [x] Trap fixtures green, asserting zero auto-fixes on "World Health
      Organization", "a driving licence", "to license a doctor", "the gas meter
      read 12 metres", "the computer program", "sulfur dioxide", "the dialog box"
      (`src/tests/fixtures.rs`; in practice they produce zero *findings*)
- [x] 69 unit tests, 13 doc tests, `clippy --all-targets -D warnings` clean
- [ ] `cargo publish --dry-run` clean (blocked until the workspace's path
      dependencies are published, `prose-sanitiser-core` first)
