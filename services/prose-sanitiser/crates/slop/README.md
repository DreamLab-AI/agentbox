# prose-sanitiser-slop

Deterministic AI writing-tell scanners for
[prose-sanitiser](https://github.com/DreamLab-AI/agentbox). No model, no
network, no rendering.

- `prose`: AI writing tells in prose and Markdown, behind the `slop-scan`
  binary, scored by Tier-1 and Tier-2 weighting.
- `design`: design anti-patterns in source, behind the `slop-detect` binary.
- `rules`: the rule tables themselves, each entry carrying a severity and a
  confidence tier.

## Capability row

| Class | Contents |
|---|---|
| **Detects and strips losslessly** | Nothing |
| **Detects and reports only** | AI stylistic tells: lexical, structural and narrative. Heuristic, not forensic |
| **Never touches** | Fenced code, blockquotes, and any line carrying the `slop-ignore` marker |

Everything here is `low-confidence-judgement`, so `--write` will not act on any
of it under any configuration.

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

## Rule tables decay

Lexical markers shift as models update, and vendors suppress flagship words. The
tables are a dated snapshot, not a constant, and each rule carries its own
confidence so a decaying signal can be demoted rather than silently trusted.
Re-derive them rather than trusting them indefinitely.

## Example

```rust
use prose_sanitiser_core::Severity;
use prose_sanitiser_slop::rules::RULES;

// The tables are plain data, so a caller can inspect or filter them.
assert!(RULES.iter().any(|rule| rule.severity == Severity::High));

// Every rule has a stable identifier, which is what a SARIF report keys on.
assert!(RULES.iter().all(|rule| !rule.id.is_empty()));
```

## The failure mode to design against

Applying the replace-with column mechanically swaps one fingerprint for another.
Kill every "leverage" and the prose acquires uniform "use", staccato fragments
and the same inverted cadence throughout. An editor clocks a de-slopped-by-AI
draft as fast as a slopped one. Treat the tables as a detector, not a target.

## Relationship to the UK rule

The UK-English rule in the prose table is owned by `prose-sanitiser-uk`; this
crate references it so the two cannot drift.

## Licence

MIT OR Apache-2.0, at your option.

## Publishing checklist

Publication candidate. Before `cargo publish`:

- [x] `license = "MIT OR Apache-2.0"`, with both licence files present
- [x] `description`, `repository`, `keywords`, `categories`, `readme` set
- [x] Pure Rust: no C dependencies, no subprocesses, no network
- [ ] Every rule carries a `since` or data-version stamp, so a stale table is
      visible rather than silent
- [ ] Crate-level `//!` docs carrying the capability matrix rows
- [ ] Every public item documented, with examples that compile
- [ ] `cargo doc --no-deps` clean, with no warnings
- [ ] No Wikipedia article prose copied verbatim. The facts are usable, the CC
      BY-SA text is not
- [ ] `cargo publish --dry-run` clean
