# Unicode: carriers, protected sets, payloads

What is contraband, what is load-bearing, and how the tool tells them apart.
This layer is deterministic: every decision classifies a codepoint and its
context, so a strip is verifiable by diffing the output. As of 2026-09-03.

## X1. Carrier classes and what each is legitimately for

Nothing here is inherently malicious. Each class exists for a reason, and the
rule is contextual rather than a blocklist.

| Class | Codepoints | Legitimate purpose |
|---|---|---|
| Zero-width | `U+200B`, `U+200C`, `U+200D`, `U+FEFF`, `U+2060` | Joining control in shaping scripts. `U+2060` is Unicode's recommended mid-text no-break marker |
| Tag block | `U+E0000`–`U+E007F` | Deprecated in 5.1; `U+E0020`–`U+E007F` un-deprecated in 8.0/9.0 for [emoji tag sequences](https://www.unicode.org/charts/PDF/UE0000.pdf), which is how the England, Scotland and Wales flags are encoded |
| Variation selectors | `U+FE00`–`U+FE0F`, `U+E0100`–`U+E01EF` | Glyph-variant and emoji-presentation selection |
| Bidi controls | `U+202A`–`U+202E`, `U+2066`–`U+2069`, `U+200E`/`U+200F` | The [UAX #9](https://unicode.org/reports/tr9/) bidirectional algorithm |
| Exotic whitespace | `U+00A0`, `U+202F`, `U+2000`–`U+200A`, `U+205F`, `U+3000`, `U+1680` | Genuine typographic spacing with distinct widths |
| Soft hyphen | `U+00AD` | Reclassified `Pd` to `Cf` in Unicode 4.0. Invisible unless a line break falls on it, which is what makes it both a legitimate hyphenation hint and a known carrier. **Preserved by default and report-only**; stripped only on request |
| Hangul fillers | `U+3164`, `U+FFA0` | Default-ignorable but **non-zero width**, and used to bypass empty-string validation |

One correction the tables carry deliberately: **`U+180E` was reclassified from
whitespace to a plain letter-class character in Unicode 6.3** and is no longer
invisible whitespace. Tables that still treat it as a space are out of date.

## X1a. The two-switch law, and the defaults

**Detection is unconditional; mutation is gated separately.** Every rule has two
switches: whether the finding exists, and whether it carries a repair.
Contraband is always reported. Whether the tool then rewrites it is a policy
question with its own default, so "tell me but do not touch it" is always a
position you can take.

| Carrier | Reported | Rewritten by default | Switch |
|---|---|---|---|
| Zero-width family, tag block, variation selectors, Hangul fillers | Always | Yes. Contraband with no legitimate reading | |
| Exotic whitespace (`U+00A0`, `U+202F`, the rest) | Always. `U+202F` is a documented GPT-4o-class artefact, so surfacing it is the point | **No.** A no-break space is load-bearing typography: it holds *10 km* and *Figure 3* together, and French orthography requires one before `;` `:` `!` `?`. Alone among the rewrites here, a diff cannot show the change, because both characters render as a space | `--normalize-spaces` |
| Homoglyphs and mixed script | Always, and the advice names the ASCII it is confusable with | **No.** Folding rewrites letters inside words, and would destroy a security note quoting an attack string verbatim | `--aggressive-homoglyphs` |
| `U+00AD` soft hyphen | Always | **No.** A typesetter's hyphenation hint as often as a carrier, and nothing in the codepoint says which | `strip_soft_hyphen` |
| Load-bearing invisibles: emoji ZWJ glue, Indic and Persian joiners, flag tags | **No.** They are not contraband | Never | `--strip-emoji-glue`, for auditing a document you already distrust |


**Back-compatibility note.** The default reversed: exotic whitespace used to be
folded unless you passed `--no-normalize-spaces`, and is now preserved unless you
pass `--normalize-spaces`. The old flag survives as a hidden no-op that prints a
pointer to the new one, so an existing script keeps running rather than dying on
an unknown argument. It also, quietly, stops doing what it used to: if a pipeline
depended on the fold, it now needs the positive flag.

**Conservatism belongs in the default, never in the tier.** Downgrading a
mechanical classification to buy safe behaviour would make the tier lie about
the evidence, and would break the fix path for a caller who explicitly asked to
apply it, since a judgement-tier finding is never fixable even under `--write`.

`TextPolicy` mirrors `CleanOptions` field for field, defaults included, so
`check_text` is a truthful preview of `clean_text`: applying the edits the check
offers reproduces the clean's output exactly. That is asserted as an invariant
rather than left to convention, because the two surfaces drifted apart three
separate times before it was: bidi controls the check declined to offer that the
cleaner stripped anyway, homoglyphs the check offered to fold that the cleaner
refused to touch, and non-breaking spaces the cleaner rewrote while the check
stayed silent.

## X2. Must-preserve rules

This is the precise legitimate-against-suspicious test. Getting it wrong
corrupts real text in scripts the author does not read, which is the worst
failure mode this tool has.

| Carrier | Preserve when | Suspicious when |
|---|---|---|
| `U+200D` | Both sides are well-formed `emoji_zwj_element`s matching an RGI sequence in [emoji-zwj-sequences.txt](https://www.unicode.org/Public/17.0.0/emoji/emoji-zwj-sequences.txt) ([UTS #51](https://www.unicode.org/reports/tr51/) ED-16) | Between non-emoji characters, or in long unstructured runs |
| `Mn`/`Mc` combining marks | Always. Never blanket-strip | Never. Only `Cf`-class controls are ever candidates |
| ZWNJ/ZWJ, Indic | Directly after a dead consonant or virama in an Indic run | In Latin-only text |
| ZWNJ, Persian | Between morphemes of one Persian word | Elsewhere |
| Bidi controls | Balanced (matching PDF/PDI) and consistent with the surrounding script direction, **in prose** | Unbalanced or nested overrides, and **any** occurrence in source code |
| `U+FEFF` | Byte offset 0 only, where it is a BOM | Anywhere else. Strip as a stray ZWNBSP |
| Regional indicators | Well-formed pairs | Singleton |
| `U+FE0F` | Directly after a character with the `Emoji` property | Chained after an arbitrary base, which is the smuggling signature |
| `U+00AD` soft hyphen | Always, by default. Nothing in the codepoint says whether it is a typesetter's hyphenation hint or a carrier | Reported either way, and stripped only when explicitly asked |

The soft hyphen deserves its own note, because it is the one carrier where the
honest answer is "cannot tell". Stripping it unconditionally is wrong in both
directions: it silently removes legitimate hyphenation from compound words, and
it dresses a judgement about the author's intent as a mechanical certainty. So
it is preserved by default, reported as `unicode-soft-hyphen` at
`low-confidence-judgement`, and never carries a fix. It is the only rule in the
Unicode layer that is not `certain-mechanical`.

`--strip-emoji-glue` overrides the preservation rules and removes the
load-bearing invisibles too. It is a paranoid mode for adversarial input, not a
default, and it will damage Indic, Persian and emoji text.

## X3. Payload decoding

Stripping a carrier deletes evidence. Decoding it produces a finding worth
acting on, which is the difference between a cleaner and a security tool.

**Variation-selector chains.** Paul Butler's
[Smuggling arbitrary data through an emoji](https://paulbutler.org/2025/smuggling-arbitrary-data-through-an-emoji/)
(February 2025) maps the 256 variation selectors onto byte values: `U+FE00`
through `U+FE0F` carry `0x00`–`0x0F` and `U+E0100` through `U+E01EF` carry
`0x10`–`0xFF`. Any base character followed by a chain of selectors therefore
carries an arbitrary byte string that survives copy and paste, renders as
nothing, and reaches an LLM's tokeniser intact. It was used in the real
*os-info-checker-es6* npm supply-chain attack.

**Tag-block sequences.** `U+E0020`–`U+E007F` map one-to-one onto printable
ASCII `0x20`–`0x7F`, so a tag run decodes directly to a hidden ASCII string.
This is the classic prompt-injection vector. It must be distinguished from a
legitimate emoji tag sequence: a valid flag is a black-flag base followed by a
short region subtag and a `U+E007F` terminator, and nothing else.

`inspect-text` reports the decoded bytes for both, alongside the offsets. Treat
a decoded payload as untrusted input: report it, never execute or follow it.

## X4. Bidi policy is split by context

The [Trojan Source attack](https://arxiv.org/abs/2111.00169) (Boucher and
Anderson, CVE-2021-42574) uses bidi controls to make source code display in one
logical order and compile in another, across C, C++, C#, JavaScript, Java, Rust,
Go, Python, SQL, Bash and Solidity. It triggered out-of-band security releases
in GCC, Clang and rustc 1.56.1. The standards response is
[UTS #55, Unicode Source Code Handling](https://www.unicode.org/reports/tr55/).

The consequence is that **one policy cannot serve both contexts**:

- **In source code:** reject bidi controls outright. There is no legitimate use
  that justifies the ambiguity, and the display/compile mismatch is the whole
  attack.
- **In prose:** preserve balanced controls. Real RTL text needs them, and
  stripping them mangles Hebrew and Arabic paragraphs. Flag only unbalanced or
  nested overrides.

## X5. Homoglyphs and mixed script

[UTS #39](https://www.unicode.org/reports/tr39/) (Revision 32, Version 17.0.0,
2025-09-04) defines `confusables.txt`, `IdentifierStatus.txt` and
`IdentifierType.txt`, restriction levels from ASCII-Only to Unrestricted,
mixed-script detection, and the **skeleton algorithm**. One detail matters and
is easy to get wrong: the skeleton is **NFD-based, not NFKC-based**. Apply NFD,
remove `Default_Ignorable` characters, substitute confusable prototypes, then
re-apply NFD. A `bidiSkeleton` variant accounts for reordering.

This is worth doing properly rather than with a hand-written table, because the
attack it defends against is well quantified.
[SilverSpeak (ACL 2025)](https://aclanthology.org/2025.genaidetect-1.1.pdf)
shows that replacing 5 to 20 per cent of Latin characters with homoglyphs
collapses seven AI-text detectors from a mean MCC of 0.64 to **-0.01**, which is
chance. The mitigation SilverSpeak itself proposes is input-side: Unicode
normalisation and character-set restriction *before* scoring.

That reframes this layer usefully. It is a **detector-hardening preprocessor**
at least as much as it is a cleaner, and that is the framing to use when
describing it.

**Detection is unconditional; the fold is not.** A default `clean-text` reports
a homoglyph and leaves it in place. `--aggressive` flags Latin confusables and
fullwidth lookalikes in `inspect-text`, and `--aggressive-homoglyphs` maps them
to ASCII Latin in `clean-text`.

That default is deliberate rather than timid. Folding honest Cyrillic or Greek
prose into Latin corrupts a real document, which is a worse outcome than
leaving a homoglyph in place for a human to judge. A document can legitimately
mix scripts, and nothing in the codepoint distinguishes a Russian word from an
impersonation of an English one.

## X6. Normalisation: NFC, never NFKC

Per [UAX #15](https://www.unicode.org/standard/reports/tr15/tr15-21.html), NFC
and NFD are canonical and lossless. **NFKC and NFKD are lossy by design.** They
expand ligatures, strip superscripts, fold full-width and half-width forms,
collapse Roman numerals and circled digits, and convert no-break space to plain
space. None of the four forms is closed under concatenation.

The standard recommendation ([W3C charmod-norm](https://www.w3.org/International/wiki/CharmodNormProposal2013),
[PRECIS RFC 8264](https://datatracker.ietf.org/doc/html/rfc8264)) is **NFC for
storage and display, NFKC only for security canonicalisation and search**. RFC
8264 deliberately separates a width-mapping rule from the normalisation rule
precisely because Stringprep's mandatory NFKC proved too lossy.

So: never apply NFKC to user-facing prose. `clean-text --nfkc` exists for the
canonicalisation case and is off by default. If you reach for it on prose, you
are changing the author's characters, not cleaning them.

Rewriting exotic spaces to `U+0020` is available as a deliberately narrower
choice than NFKC, but it is **not** a default: see X1a. A no-break space is
load-bearing typography, and folding it is the one rewrite in this layer a diff
cannot show, since both characters render as a space.

## X7. What this layer cannot see

It cannot detect a statistical sampling watermark. Those are defined entirely by
which tokens a model selected, they add nothing to the text and hide no
characters (Anthropic says so explicitly), and no amount of codepoint inspection
will ever see one. See [provenance.md](provenance.md) P3.

A clean `inspect-text` therefore means one specific thing: no invisible carrier,
no smuggled payload, no homoglyph substitution. It is not a statement about
authorship.
