# prose-sanitiser-unicode

Layer A of [prose-sanitiser](https://github.com/DreamLab-AI/agentbox):
deterministic invisible-Unicode and homoglyph surgery on plain text.

No model, no network, no subprocesses. Every decision is a classification of the
codepoint and its context, so a strip is verifiable by diffing the output.

## Detects and losslessly strips

- Invisible Cf-class controls: the zero-width family, tag block, variation
  selectors, bidi controls, exotic whitespace, soft hyphen, Hangul fillers.
- Homoglyph and mixed-script substitution.

## Never touches

- `U+200D` inside a well-formed RGI emoji ZWJ sequence.
- `Mn`/`Mc` combining marks — only `Cf`-class controls are ever candidates.
- ZWNJ/ZWJ after an Indic virama, or between Persian morphemes.
- Balanced bidi controls in genuine RTL prose.
- `U+FEFF` at byte offset 0, where it is a BOM.
- NFKC normalisation of user-facing prose. NFC only; NFKC is lossy by design.

## What it cannot do

It cannot detect statistical sampling watermarks (SynthID-Text, Kirchenbauer,
Aaronson, or Claude's). Those are defined by which tokens a model selected and
are undetectable without the vendor key. No amount of codepoint inspection sees
them.

## Licence

MIT OR Apache-2.0.
