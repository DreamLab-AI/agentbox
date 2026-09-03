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

Measured 2026-09-03 against ruleset **2026.09.03**, using the `ps-eval` harness
over RAID (MIT), MAGE (Apache-2.0) and LLM-DetectAIve (CC BY-SA 4.0). Reported as
**TPR at 1 per cent FPR**, never AUROC: high AUROC routinely coexists with a
near-zero true-positive rate at the only thresholds a deployment would use.

### Overall discrimination

| Corpus | Human / machine docs | Score | Threshold (1% FPR) | **TPR@1%FPR** | Realised FPR |
|---|---|---|---|---|---|
| RAID, unattacked | 2,000 / 2,000 | raw `slop_score` | 30.0 | **2.8%** | 1.0% |
| RAID, unattacked | 2,000 / 2,000 | per 1,000 words | 103.1 | **3.4%** | 1.0% |
| MAGE | 1,500 / 1,500 | raw `slop_score` | 8.0 | **0.9%** | 0.9% |
| MAGE | 1,500 / 1,500 | per 1,000 words | 61.2 | **1.7%** | 0.9% |
| LLM-DetectAIve, human vs machine-humanised | 20 / 20 | per 1,000 words | 28.2 | **50.0%** | 0.0% |

**Read that honestly.** On general-domain corpora the aggregate slop score
separates human from machine text barely better than chance at a usable
operating point. On MAGE it is worse than that: the median raw score is 2.00 for
human documents and 0.00 for machine ones, so the raw score points the *wrong
way* on that corpus and the 0.9 per cent TPR is measuring noise. The LLM-DetectAIve row looks strong, but n is 20 per class and
that corpus is deliberately composed of heavily-marked machine text, so it is an
illustration and not a result. This crate is a **style linter with an evidence
base**, not a detector, and these numbers are the reason the whole thing is
report-only.

### Per-rule firing rates on human prose

Share of documents each rule fires on, RAID (2,000 human, 2,000 machine),
default flags:

| Rule | Human | Machine | Ratio |
|---|---|---|---|
| `claudish-structure` | 0.05% | 0.25% | 5.0 |
| `passive-tell` | 0.30% | 1.25% | 4.2 |
| `throat-clearing` | 0.55% | 1.15% | 2.1 |
| `negative-parallelism` | 1.40% | 2.70% | 1.9 |
| `tier1-vocab` | 11.80% | 21.70% | 1.8 |
| `preamble-label` | 0.15% | 0.25% | 1.7 |
| `copula-substitution` | 1.15% | 1.60% | 1.4 |
| `us-spelling` | 30.35% | 40.80% | 1.3 |
| `agg` (density checks) | 1.05% | 1.05% | **1.0** |
| `hedge-words` | 2.80% | 2.70% | **1.0** |
| `the-opener` | 41.10% | 38.00% | **0.9** |
| `us-spelling-sense` | 5.15% | 3.45% | **0.7** |
| `insider-voice` | 0.10% | 0.05% | **0.5** |

**Five rules do not discriminate on this corpus at all**, and two of them point
the wrong way. That is a finding about the rules, not a defect in the run.

`agg` is a special case and its 1.0 should not be read as "the density checks do
not work". It is a single rule id covering four unrelated whole-file checks —
em-dash density, em-dashes in list items, transition-word density and the Tier-2
cluster — so the ratio averages four different signals into one uninterpretable
number. The id predates the versioned table and is kept for output
compatibility; the `structural-*` rules measure the same territory one signal at
a time, which is why their ratios mean something and this one does not.

**And the ranking does not transfer between corpora.** On MAGE, `hedge-words`
scores 0.69, `claudish-structure` 0.56, `preamble-label` 0.54, and
`claudish-filler` and `insider-voice` fire on nothing at all — so
`claudish-structure`, the best discriminator on RAID at 5.0, is among the worst
on MAGE. A rule's ratio is a property of the rule *and the corpus*, and any
single-corpus ranking of these rules, including the one above, should be read
with that in mind.

`the-opener` fires on two documents in five of human prose and *slightly less*
often on machine prose. It was demoted from `high-confidence-stylistic` to
`low-confidence-judgement` on this measurement and is now a house-style rule
only. That demotion is what the dated, versioned table is for.

`us-spelling` at 30.35 per cent is not a false-positive rate: both corpora are
predominantly American English, and the rule is correctly identifying American
spelling. For the rate that *is* a false-positive rate, see below.

### False positives on British English

The research brief records that **no published study measures detector or linter
false positives on British English**. This is that measurement, over 2,000
British-English documents totalling 1.2 million words, run 2026-09-03 against
ruleset 2026.09.03:

| Source | Documents |
|---|---|
| Hansard (House of Commons debates), via TheyWorkForYou bulk XML | 964 |
| GOV.UK publications | 436 |
| Project Gutenberg (British literature) | 600 |

Every finding on this corpus is a false positive by construction: the text is
human-written British English, so nothing in it should be reported as an
Americanism or as an AI tell.

| Rule | Documents flagged | Findings per 1,000 words | Auto-fixed |
|---|---|---|---|
| `the-opener` | 21.90% | 0.798 | 0 |
| `tier1-vocab` | 17.75% | 0.429 | 0 |
| `agg` (density checks) | 16.90% | 0.286 | 0 |
| `negative-parallelism` | 10.00% | 0.183 | 0 |
| `us-spelling-sense` | 8.15% | 0.181 | 0 |
| `hedge-words` | 8.10% | 0.158 | 0 |
| **`us-spelling`** | **5.60%** | **0.097** | **0** |
| `throat-clearing` | 2.50% | 0.045 | 0 |
| `copula-substitution` | 1.95% | 0.034 | 0 |
| `preamble-label` | 1.70% | 0.028 | 0 |
| `claudish-structure` | 1.20% | 0.020 | 0 |
| `passive-tell` | 1.15% | 0.019 | 0 |
| `insider-voice` | 0.30% | 0.005 | 0 |
| `claudish-filler` | 0.15% | 0.002 | 0 |

**The number that matters is the last column.** Across 2,000 British documents
and 1.2 million words, **not one finding was auto-fixed**. The UK rules split
their output between `us-spelling`, which carries a replacement and is gated
behind `--write`, and `us-spelling-sense`, which carries none and cannot be
applied under any configuration; the sense-dependent traps that made the
original single regex unsafe now land in the second bucket. So the crate's
worst case on British prose is noise in a report, never a corrupted document.

**What it actually matched**, read from the reported byte offsets rather than
inferred. `us-spelling`: *gray* x10, *honor* x5, *recognize* x3, *afterward* x2,
*agonized* x2, *baptized* x2, *behavior* x2, *characterized* x2, *colored* x2,
*fulfill* x2, *honors* x2, *labeling* x2. Spot-checked, those are genuine
Americanisms, mostly in nineteenth-century Gutenberg text and quoted American
sources. So 5.60 per cent is an upper bound on false positives rather than a
count of them, and it is roughly one flagged document in eighteen against the
**61.3 per cent** false-positive rate seven commercial detectors showed on TOEFL
essays (Liang et al. 2023, *Patterns*).

`us-spelling-sense` is dominated by a single token: *practice* and *practices*
are 67 per cent of its output on British prose (146 of 218 findings), then
*prize* x14, *onward* x8, *bark* x7, *program* x6. A rule that is two-thirds one
word is a rule to watch, and it is exactly why that one is report-only.

### The composition changed, not the count

The interesting comparison is against the previous build on the same 2,000
documents. The old flat alternation produced 120 `us-spelling` findings; the
VarCon rebuild produces 117. Almost the same headline number, and almost
nothing in common:

| | Old regex | VarCon rebuild |
|---|---|---|
| Findings | 120 | 117 |
| Sense-dependent, reported as plain misspellings | 37 (*licensed* x26, *license* x5, *licenses* x3, *meter* x3) | 0 — split into report-only `us-spelling-sense` |
| **Findings on correct British spellings** | **26** (*fulfilled*, *fulfilling*) | **0** |
| Auto-fixable | — | 0 |

Twenty-six of the old build's findings were on *fulfilled* and *fulfilling*,
which are correct British English. The rule was reporting good spelling as bad,
and a reader looking only at the total would never have seen it. That is the
case for measuring composition rather than counts.

### Structural measures

Over 1,252 human and 1,207 machine documents long enough for a rate to mean
anything:

| Measure | Threshold | Human | Machine | Ratio |
|---|---|---|---|---|
| Oxford-comma density | 55.51 per 10k (Pew, Jan 2026) | 5.99% | 19.22% | **3.2** |
| Em-dash density | 11.19 per 10k (Pew, Jan 2026) | 1.76% | 3.40% | 1.9 |
| Sentence-length CV | < 0.20 | 6.87% | 14.75% | 2.1 |
| Tricolon density | 40 per 10k | 10.22% | 10.60% | **1.0** |

The Oxford-comma rate at the published Pew threshold is the single best
discriminator in the crate, which is a mildly embarrassing result for a rule
about punctuation nobody objects to. The tricolon measure does **not** separate
the two classes at any threshold tried; it is retained as a house-style budget
and is documented in the rule table as not being an authorship signal. The
sentence-length floor was retuned from 0.35 to 0.20 on this data, which cut its
human firing rate from 36.7 per cent to 6.9 per cent.

### Reproducing it

Every figure above comes from the `ps-eval` harness, which computes TPR at 1 per
cent FPR by taking the threshold at the 99th percentile of the human score
distribution. There is deliberately no second implementation in this crate: a
duplicate sweep would only produce a number to reconcile.

```
cargo build --workspace --release
PS_BIN_DIR=$PWD/target/release ps-eval --root <corpora> run --out report.json
```

Corpus provenance and licences are in the harness's `MANIFEST.md`: RAID (MIT),
MAGE (Apache-2.0), LLM-DetectAIve (CC BY-SA 4.0), and for the British set,
Hansard via TheyWorkForYou (OPL v3.0), GOV.UK (OGL v3.0) and Project Gutenberg
(public domain). Every British document predates 2022, so none of it can contain
model output.

## Licence

MIT OR Apache-2.0, at your option.

## Publishing checklist

Publication candidate. Before `cargo publish`:

- [x] `LICENSE-MIT` and `LICENSE-APACHE` present and linked into the crate
- [ ] **Licence position resolved by the operator.** The manifest declares
      `MIT OR Apache-2.0`; ADR-016 (2026-05-16) records first-party code as
      AGPL-3.0-only and the repository root is AGPL-3.0. Unresolved and not
      settled in these docs; the adversarial review of 2026-09-03 records it as
      release-blocking (finding 9). See the workspace README
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
