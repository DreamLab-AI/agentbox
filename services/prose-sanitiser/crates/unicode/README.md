# prose-sanitiser-unicode

Layer A of [prose-sanitiser](https://github.com/DreamLab-AI/agentbox): deterministic
invisible-Unicode, steganographic-payload and homoglyph surgery on plain text.

No model, no network, no subprocesses. Every decision is a classification of a
codepoint and its context, so a strip is verifiable by diffing the output.

## What it does

**Decodes smuggled payloads rather than only stripping them.** Reporting *what was
hidden* is the useful half.

- **Variation-selector chains** in [Paul Butler's byte
  encoding](https://paulbutler.org/2025/smuggling-arbitrary-data-through-an-emoji/) —
  the carrier used in the real *os-info-checker-es6* npm supply-chain attack. Chains
  after non-emoji bases are caught too.
- **Tag-block ASCII** (`U+E0020..=U+E007E`), distinguished from the legitimate
  England, Scotland and Wales flag sequences.
- **Zero-width binary runs**, where eight or more stacked joiners are never shaping.

The discriminator is one line: **legitimate use is exactly one variation selector per
base.** No well-formed sequence stacks two, so a chain of two or more is mechanically
certain, and a lone selector is deliberately left alone.

**Detects homoglyph and mixed-script substitution** via [UTS
#39](https://www.unicode.org/reports/tr39/) — `confusables.txt` skeletons,
Identifier_Status and mixed-script detection — through the `unicode-security` crate,
rather than a hand-written table.

**Applies a bidi policy that depends on context.** Every control is contraband in
source code (the Trojan Source attack,
[CVE-2021-42574](https://arxiv.org/abs/2111.00169), per [UTS
#55](https://www.unicode.org/reports/tr55/)); balanced controls are preserved in prose
that genuinely contains right-to-left script, with unbalanced and nested-unbalanced
nesting reported either way.

**Classifies invisible and format-class carriers**: the zero-width family, exotic
whitespace, soft hyphen, Hangul fillers, private-use codepoints.

## Never touches

A strip here corrupts a real document, so the fixture suite treats any of these as a
hard failure rather than a tuning question.

- `U+200D` inside a well-formed emoji ZWJ sequence.
- `Mn`/`Mc` combining marks — only `Cf`-class controls are ever candidates.
- ZWNJ/ZWJ after an Indic virama, or between Persian morphemes.
- Balanced bidi controls in genuine RTL prose.
- `U+FEFF` at offset 0, where it is a BOM and only there.
- Regional-indicator pairs and RGI emoji tag sequences.
- NFKC normalisation of user-facing prose. It is lossy by design ([UAX
  #15](https://www.unicode.org/standard/reports/tr15/tr15-21.html)); NFC only, and only
  when asked.

## Two views of the same surface

`inspect_text` and `clean_text` count codepoints, which is what an audit sweep wants.
`check::check_text` reports the same surface as byte-spanned `Finding`s, which is what
a SARIF exporter, an LSP or a `fix()` pass wants. Neither mutates its input.

```rust
use prose_sanitiser_core::surrogate;
use prose_sanitiser_unicode::{clean_text, CleanOptions};

let dirty = surrogate::decode("in\u{200B}vis\u{200D}ible".as_bytes());
let (clean, stats) = clean_text(&dirty, CleanOptions::default());
assert_eq!(surrogate::to_lossy_string(&clean), "invisible");
assert_eq!(stats.removed_count, 2);
```

Every rule this crate emits is `ConfidenceTier::CertainMechanical` and is published in
`RULES` for the SARIF driver table.

## Honest coverage

`unicode-security` 0.1.2 ships **Unicode 16.0.0** data, while UTS #39 is at revision 32
(Unicode 17.0.0), so coverage is partial and this crate says where.

Measured against the 71-entry hand table it replaces: the skeleton reproduces **all 19
Cyrillic entries exactly** and covers thousands of codepoints besides (Greek, Armenian,
Cherokee, mathematical alphanumerics). But `confusables.txt` folds only **30 of 52
fullwidth Latin letters** — width folding is NFKC's remit and the standard omits it
deliberately — so one mechanical override (`codepoint - 0xFEE0`, applied only where
both ends are alphanumeric) closes that gap. That is the only override maintained;
every other prototype comes from the standard's own data.

Two further limits, stated rather than hidden:

- The **skeleton is a comparison key, never a transformation.** It is lossy by design
  (`привет` skeletons to `πpᴎʙeᴛ`, `café` to `cafe` plus a combining acute, and ASCII
  `1` to `l`), so prose is never folded through it wholesale and ASCII is never folded
  at all.
- The **zero-width bit mapping is a convention, not a standard.** The *presence* of an
  eight-plus run is certain; the recovered bytes are a best-effort reading.

## Measured

On the SilverSpeak homoglyph fixtures (5, 10 and 20 per cent substitution rates):
**precision 1.0000, recall 1.0000**. The legitimate-content controls — emoji ZWJ,
Devanagari, Persian, Hebrew-Latin, BOM, the three subdivision flags — produce **zero
strips** and round-trip byte-identical.

## What it cannot do

It cannot detect statistical sampling watermarks (SynthID-Text, Kirchenbauer, Aaronson,
or Claude's). Those are defined by which tokens a model selected, are undetectable
without the vendor key, and no amount of codepoint inspection can see them.

## Licence

MIT OR Apache-2.0.
