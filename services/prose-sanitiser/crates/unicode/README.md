# prose-sanitiser-unicode

Deterministic invisible-Unicode, steganographic-payload and homoglyph surgery on
plain text. Layer A of
[prose-sanitiser](https://github.com/DreamLab-AI/agentbox).

No model, no network, no subprocesses. Every decision classifies a codepoint and
its context, so a strip is verifiable by diffing the output.

## The four things it does

1. **Classifies invisible and format-class carriers**: the zero-width family,
   the tag block, variation selectors, bidi controls, exotic whitespace, soft
   hyphen, Hangul fillers.
2. **Decodes smuggled payloads rather than only stripping them**:
   variation-selector chains in Paul Butler's byte encoding, tag-block ASCII,
   and zero-width binary. A finding carries the recovered bytes.
3. **Detects homoglyph and mixed-script substitution** using UTS #39
   `confusables.txt` skeletons, `Identifier_Status` and mixed-script detection.
4. **Applies a bidi policy that depends on context**: every control is
   contraband in source code (Trojan Source, CVE-2021-42574), while balanced
   controls are preserved in prose that genuinely contains right-to-left script.

## Capability row

| Class | Contents |
|---|---|
| **Detects and strips losslessly**, verifiable by diff | Invisible `Cf`-class controls: the zero-width family, tag block, variation selectors, bidi controls, exotic whitespace, soft hyphen, Hangul fillers. Variation-selector, tag-block and zero-width payloads, **including decoding them**. Homoglyph and mixed-script substitution |
| **Detects and reports only** | Nothing. Everything it flags, it can remove |
| **Never touches** | `U+200D` inside a well-formed emoji ZWJ sequence (UTS #51 ED-16); `Mn`/`Mc` combining marks, since only `Cf` controls are ever candidates; ZWNJ/ZWJ after an Indic virama or between Persian morphemes; balanced bidi controls in genuine RTL prose; `U+FEFF` at byte offset 0, where it is a BOM; regional-indicator pairs and RGI emoji tag sequences, which are well-formed flags rather than carriers; NFKC normalisation of user-facing prose, which is lossy by design (UAX #15) |

## Two views of the same surface

`inspect_text` and `clean_text` count codepoints, which is what an audit sweep
wants. `check_text` (and the `check_prose` convenience over it) reports the same
surface as `Finding`s with byte spans, which is what a SARIF exporter, an LSP
server or a patch-building `fix()` pass wants. Neither view mutates its input.

Rule identifiers are stable, because they are what a SARIF report keys on:
`unicode-invisible`, `unicode-homoglyph`, `unicode-vs-payload`,
`unicode-tag-payload`, `unicode-zw-payload`, `unicode-bidi`.

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

Decoding a smuggled payload, which is the capability worth having over a plain
strip:

```rust
use prose_sanitiser_core::surrogate::decode;
use prose_sanitiser_unicode::stego::{byte_to_variation_selector, scan, PayloadKind};

// A base character trailing a Butler variation-selector chain carrying "hi".
// The chain renders as nothing and survives copy and paste.
let mut smuggled = String::from("a");
for byte in b"hi" {
    smuggled.push(byte_to_variation_selector(*byte));
}

let payloads = scan(&decode(smuggled.as_bytes()));
assert_eq!(payloads.len(), 1);
assert_eq!(payloads[0].kind, PayloadKind::VariationSelector);
assert_eq!(payloads[0].base, Some('a'));
assert_eq!(payloads[0].printable(), "hi");
assert_eq!(payloads[0].hex(), "6869");
```

Treat a decoded payload as untrusted input: report it, never execute or follow
it. `StegoPayload::printable` is deliberately lossy and for human eyes only;
`bytes` is the ground truth.

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
