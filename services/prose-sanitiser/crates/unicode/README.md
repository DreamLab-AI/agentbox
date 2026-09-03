# prose-sanitiser-unicode

Deterministic invisible-Unicode and homoglyph surgery on plain text. Layer A of
[prose-sanitiser](https://github.com/DreamLab-AI/agentbox).

No model, no network, no subprocesses. Every decision classifies a codepoint and
its context, so a strip is verifiable by diffing the output.

## Capability row

| Class | Contents |
|---|---|
| **Detects and strips losslessly**, verifiable by diff | Invisible `Cf`-class controls: the zero-width family, tag block, variation selectors, bidi controls, exotic whitespace, soft hyphen, Hangul fillers. Variation-selector and tag-block smuggled payloads, **including decoding the hidden bytes**. Homoglyph and mixed-script substitution (UTS #39 skeleton and restriction levels) |
| **Detects and reports only** | Nothing. Everything it flags, it can remove |
| **Never touches** | `U+200D` inside a well-formed RGI emoji ZWJ sequence (UTS #51 ED-16); `Mn`/`Mc` combining marks, since only `Cf` controls are ever candidates; ZWNJ/ZWJ after an Indic virama or between Persian morphemes; balanced bidi controls in genuine RTL prose; `U+FEFF` at byte offset 0, where it is a BOM; NFKC normalisation of user-facing prose, which is lossy by design (UAX #15) |

## What it cannot do

It cannot detect a statistical sampling watermark (SynthID-Text, Kirchenbauer,
Aaronson, or Claude's own mark). Those are defined by which tokens a model
selected, they add nothing to the text and hide no characters, and no amount of
codepoint inspection will see one.

A clean report therefore means one specific thing: no invisible carrier, no
smuggled payload, no homoglyph substitution. It is not a statement about
authorship.

## Example

```rust
use prose_sanitiser_core::surrogate::{decode, to_lossy_string};
use prose_sanitiser_unicode::{clean_text, inspect_text, CleanOptions};

// "hi" with a zero-width space smuggled between the letters.
let units = decode("h\u{200b}i".as_bytes());

let report = inspect_text(&units, false, false);
assert_eq!(report.suspicious_total, 1);

let (cleaned, stats) = clean_text(&units, CleanOptions::default());
assert_eq!(to_lossy_string(&cleaned), "hi");
assert_eq!(stats.removed_count, 1);
```

Text is handled as `Unit` rather than `char` so that lone surrogates in malformed
input survive a round trip instead of being silently replaced.

## Why this is a detector-hardening preprocessor

[SilverSpeak (ACL 2025)](https://aclanthology.org/2025.genaidetect-1.1.pdf)
showed that replacing 5 to 20 per cent of Latin characters with homoglyphs
collapses seven AI-text detectors from a mean MCC of 0.64 to -0.01, which is
chance. The mitigation the authors propose is input-side: Unicode normalisation
and character-set restriction before scoring. That is exactly what this crate
does, so it hardens a detector at least as much as it cleans a document.

## Licence

MIT OR Apache-2.0, at your option.

## Publishing checklist

Publication candidate. Before `cargo publish`:

- [x] `license = "MIT OR Apache-2.0"`, with both licence files present
- [x] `description`, `repository`, `keywords`, `categories`, `readme` set
- [x] Pure Rust: no C dependencies, no subprocesses, no network
- [x] Crate-level `//!` docs carrying the capability matrix rows
- [ ] Every public item documented, with examples that compile
- [ ] `cargo doc --no-deps` clean, with no warnings
- [ ] Legitimate-Unicode fixture suite green: emoji ZWJ sequences, Indic virama
      forms, Persian compounds, RTL prose, BOMs, regional-indicator flags. Any
      strip there is a hard failure
- [ ] `cargo publish --dry-run` clean
