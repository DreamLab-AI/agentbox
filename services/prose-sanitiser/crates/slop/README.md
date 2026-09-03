# prose-sanitiser-slop

Deterministic AI writing-tell scanners for
[prose-sanitiser](https://github.com/DreamLab-AI/agentbox). No model, no
network, no rendering.

- `check`: the library API. `SlopChecker` implements `Check`, so
  `check(&str, &Config) -> Vec<Finding>` returns byte-spanned findings without
  mutating anything. There is deliberately no `Fix` implementation.
- `prose`: AI writing tells in prose and Markdown, behind the `slop-scan`
  binary, scored by Tier-1 and Tier-2 weighting.
- `structural`: whole-document measures reported as rates per 10,000 words
  against the published Common Crawl figures. Opt-in.
- `design`: design anti-patterns in source, behind the `slop-detect` binary.
- `rules`: the rule tables themselves, each entry carrying a severity, a
  confidence tier, `since` and `reviewed` dates and its sources.

## Capability row

| Class | Contents |
|---|---|
| **Detects and strips losslessly** | Nothing |
| **Detects and reports only** | AI stylistic tells: lexical, structural and narrative. Heuristic, not forensic |
| **Never touches** | Fenced code, blockquotes, and any line carrying the `slop-ignore` marker |

Nothing here is `certain-mechanical`, so no slop rule is ever auto-fixed. The
lexical marker lists are all `low-confidence-judgement` and report-only. The
structural tells with a published measurement behind them are
`high-confidence-stylistic`, which gates an opt-in fix rather than an automatic
one; in practice no rule in this crate emits a `replacement`, so the tier
records how far to trust the pattern rather than licensing a rewrite.

## What a finding does and does not mean

These are population-level signals. The lexical markers are well quantified
across large corpora, notably
[Kobak et al., *Science Advances* 11, eadt3813](https://doi.org/10.1126/sciadv.adt3813)
(at least 13.5 per cent of 2024 PubMed abstracts show LLM involvement) and the
[Pew Research Center Data Labs analysis](https://www.pewresearch.org/data-labs/2026/08/20/how-much-of-the-internet-is-written-with-ai/)
(em-dashes per 10,000 words roughly doubled between January 2023 and January
2026; negative parallelism nearly tripled).

But **no single marker identifies a document**. A clean scan is not evidence of
human authorship and a dirty one is not evidence of a model. A finding is a
prompt for an editor to look, never a verdict.

Report TPR at 1 per cent FPR rather than AUROC if you evaluate this crate: high
AUROC routinely coexists with near-zero true-positive rate at the thresholds any
real deployment needs.

## Rule tables decay, so they are versioned

Lexical markers shift as models update, and vendors suppress flagship words. A
table frozen at the moment it was written rots silently: it keeps reporting, the
reports keep looking authoritative, and nothing in the output says the evidence
has moved. Three pieces of machinery answer that.

- `RULESET_VERSION` (currently `2026.09.03`) stamps every SARIF and JSON Lines
  report, so a finding can be traced to the table that produced it.
- Every rule carries `since`, `reviewed` and its `sources`, so a rule nobody has
  re-checked in two years is visible as data. `slop-scan --explain-rules` prints
  the lot.
- `rules::CHANGELOG` records what moved between versions and on what evidence.

### What changed in 2026.09.03

The `tier1-vocab` alternation matched bare stems only, so *delves* — the most
cited marker of all, in its commonest inflection — went unreported. That is
fixed, along with the *showcase* and *boast* families, and eleven markers with a
published excess-frequency measurement were added (*pivotal*, *garner*,
*encompass*, *commendable*, *invaluable*, *adept*, *bolster*, *unravel*,
*spearhead* among them). Ordinary high-frequency verbs that appear in the excess
sets, such as *navigate* and *tackle*, were deliberately left out: their
false-positive cost on human prose outweighs the signal.

**Nothing was dropped.** Pangram reports *delve* declining; the Pew tracking of a
fixed 27-word list over roughly 490,000 Common Crawl pages found the category
more than doubled between January 2023 and January 2026. The class is the signal,
not any single word, so one vendor's claim about one word is not grounds for
removal.

The `us-spelling` rule no longer carries a word list at all. It builds its
alternation from the VarCon table in `prose-sanitiser-uk`, filtered to the
entries VarCon marks unconditional, so *meter* the instrument, *licence* the
verb, *program* the computing sense, *dialog* the UI element and *sulfur* the
chemical no longer match at all.

## Structural measures

`--structural` adds the whole-document measures. Three have a published rate,
from the Pew Research Center Data Labs tracking, per 10,000 words:

| Measure | Jan 2023 | Jan 2026 | Tier |
|---|---|---|---|
| Em-dashes | 5.79 | 11.19 | `high-confidence-stylistic` |
| Oxford commas | 34.04 | 55.51 | `high-confidence-stylistic` |
| Negative parallelism | 0.87 | 2.36 | `high-confidence-stylistic` |
| Tricolon | no published rate | | `low-confidence-judgement` |
| Sentence-length variance | no published rate | | `low-confidence-judgement` |
| Paragraph uniformity | no published rate | | `low-confidence-judgement` |

The bottom three are widely observed practitioner heuristics with no measurement
study behind them, and are reported at the tier the evidence supports rather
than the tier the intuition suggests.

Rates are suppressed entirely below 250 words, because a rate over a paragraph
is noise. The serial-comma detector requires two commas in one clause, not one:
counting every `, and` would score a comma splice as a list and inflate the rate
on any prose that punctuates normally.

## Suppression

Beyond the legacy `slop-ignore` line marker, the crate honours the workspace
HTML-comment directives, which are inert in every Markdown renderer:

```markdown
<!-- prose-sanitiser-disable tier1-vocab -->
We delve into it deliberately, here.
<!-- prose-sanitiser-enable tier1-vocab -->

One line only: <!-- prose-sanitiser-disable-line hedge-words -->
```

`<!-- prose-sanitiser off -->` and `<!-- prose-sanitiser on -->` are accepted as
Vale-compatible aliases, as is `<!-- prose-sanitiser:ignore RULE -->`.

## Language pre-filter

English-only rules are held back on paragraphs the `whatlang` pre-filter does
not read as English, so *robust* in German and *color* in Dutch do not generate
findings. The policy is that uncertainty means English: a short paragraph, an
unreliable classification or a span of code and numbers is scanned rather than
skipped, so the filter can never silently disable a rule. `--no-language-filter`
turns it off.

## Example

```rust
use prose_sanitiser_core::{Check, ConfidenceTier, Config};
use prose_sanitiser_slop::{rules::RULES, SlopChecker};

// Checking never mutates and never touches the filesystem.
let findings = SlopChecker::new().check("We delve into the tapestry.", &Config::new());
assert_eq!(findings[0].rule_id, "tier1-vocab");

// No slop rule may ever be applied by a machine, whatever the configuration.
assert!(RULES
    .iter()
    .all(|rule| rule.confidence != ConfidenceTier::CertainMechanical));
assert!(findings[0].to_edit(&Config::new().with_write(true)).is_none());
```

## The failure mode to design against

Applying the replace-with column mechanically swaps one fingerprint for another.
Kill every "leverage" and the prose acquires uniform "use", staccato fragments
and the same inverted cadence throughout. An editor clocks a de-slopped-by-AI
draft as fast as a slopped one. Treat the tables as a detector, not a target.

## Relationship to the UK rule

The UK-English rule in the prose table is owned by `prose-sanitiser-uk`. This
crate holds no spelling list: `rules::uk` builds the alternation from that
crate's VarCon table at first use, so the two cannot drift.

## Measured performance

<!-- EVALUATION-PLACEHOLDER -->

## Licence

MIT OR Apache-2.0, at your option.

## Publishing checklist

Publication candidate. Before `cargo publish`:

- [x] `LICENSE-MIT` and `LICENSE-APACHE` present and linked into the crate
- [ ] **Licence position settled with the copyright holder.** ADR-016
      (2026-05-16, licence consolidation) records all first-party code as
      AGPL-3.0-only, having "eliminated remaining MIT designations from
      sub-package manifests", and the repository root is AGPL-3.0. Ten
      `services/*` crates declare `MIT OR Apache-2.0` against that ADR. Adding
      the licence texts did not resolve the conflict. A hard publication
      blocker: see the workspace README
- [x] `description`, `repository`, `keywords`, `categories`, `readme` set
- [x] Pure Rust: no C dependencies, no subprocesses, no network
- [x] Every rule carries `since`, `reviewed` and its sources, and the tables
      carry a `RULESET_VERSION` and a changelog, so a stale table is visible
      rather than silent
- [x] Crate-level `//!` docs carrying the capability matrix rows
- [x] Every public item documented, with examples that compile
- [x] `cargo doc --no-deps` clean, with no warnings
- [ ] No Wikipedia article prose copied verbatim. The facts are usable, the CC
      BY-SA text is not
- [ ] `cargo publish --dry-run` clean
