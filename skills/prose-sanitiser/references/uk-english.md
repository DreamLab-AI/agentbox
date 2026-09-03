# UK English

The rules, the data behind them, and the far longer list of things that look
like UK-English rules but are traps. As of 2026-09-03; the VarCon-backed
subsystem is landing on `rust/prose-sanitiser-hardening` and this file describes
the design it implements.

The one-sentence summary: **span exclusion runs first, then sense
disambiguation, then confidence-tiered fixes.** Only unconditional dialect pairs
with no organisation-name collision may ever be auto-fixed. Everything
sense-dependent or gazetteer-adjacent is report-only, forever.

## U1. Why the old rule was unsafe

The previous implementation was a single flat regex alternation including
`license`, `meter`, `catalog` and `fulfill`, with no sense disambiguation, no
proper-noun protection and no code-span exclusion. It flags "a driving licence
issued to license a doctor", "gas meter", "dialog box" and "World Health
Organization". Every one of those is either correct British English already or a
proper noun, so the rule produced wrong advice roughly half the time on
technical prose.

That is why every finding it produced was tiered `low-confidence-judgement` and
carried no replacement: the tier system was doing the safety work the pattern
could not.

## U2. VarCon: the data source

[VarCon](https://wordlist.aspell.net/varcon-readme/) (Kevin Atkinson, part of
the SCOWL project) encodes region and variant for each spelling:

| Code | Region |
|---|---|
| `A` | American |
| `B` | British, `-ise` |
| `Z` | British, `-ize` (Oxford) |
| `C` | Canadian |
| `D` | Australian |

with variant-status tags `.` equal, `v` variant, `V` seldom, `-` possible,
`x` improper. The critical property is that it encodes the Oxford/Cambridge
split as **two distinct British categories in the same table**, which is exactly
the primitive an `--oxford` flag needs. A line reads
`A Z: abnormalize / B: abnormalise`.

**Licence.** Atkinson's own permissive notice, functionally BSD/MIT-equivalent
with no copyleft, so it is safe to vendor into an MIT OR Apache-2.0 crate. The
vendored copy, its provenance and the reproduced notice live in
`services/prose-sanitiser/crates/uk/data/`, with a `.sha256` beside it.

**Licence trap worth knowing:** do not take en_GB Hunspell dictionaries from
LibreOffice. They are
[GPL 2.0 / LGPL 2.1 / MPL 1.1 tri-licensed](https://github.com/hunspell/hunspell/blob/master/license.hunspell).
Mozilla had to re-derive its dictionaries from SCOWL in 2007 for this reason.

## U3. Span exclusion, which runs first

No spelling rule fires inside any of these:

- Fenced code blocks, inline code spans, indented code.
- HTML attributes and tags.
- YAML or TOML front matter.
- URLs, email addresses, file paths, package names.
- Direct quotations.

The reason is not politeness. `color` is a CSS property, `initialize`,
`analyze` and `serialize` are function names, `--color` is a CLI flag, and
"correcting" any of them breaks the document. A language pre-filter also keeps
UK rules from firing on non-English spans.

## U4. The -ise / -ize question and the `--oxford` flag

[Oxford spelling](https://en.wikipedia.org/wiki/Oxford_spelling)
(`en-GB-oxendict`) uses `-ize` for Greek `-izein` verbs and is house style at
OUP, *Nature* and the TLS. Cambridge University Press, the *Guardian*, the BBC
and UK government use `-ise`. The BNC ratio is roughly 3:2 in favour of `-ise`.

**Default to `-ise`. Gate `-ize` behind `--oxford`,** built directly on VarCon's
`B` against `Z` tags.

**The always-ise set** is untouched regardless of the flag, because the ending
is not the Greek suffix but part of a longer root: `-cise` cutting, `-mise`
sending, `-vise` seeing, `-prise` taking, `-guise` form.

> advertise, advise, apprise, arise, chastise, circumcise, comprise, compromise,
> demise, despise, devise, disguise, enfranchise, disfranchise, excise,
> exercise, franchise, guise, improvise, incise, merchandise, premise, prise
> (open), promise, revise, supervise, surmise, surprise, televise, enterprise,
> reprise

Cross-check: none of these form nouns in `-isation`, `-ization` or `-ism`, with
*improvisation* the sole exception. Sources:
[World Wide Words](https://www.worldwidewords.org/qa-ise1.html) and the
[Chatham House style guide](https://www.chathamhouse.org/sites/default/files/ch-style-guide-for-the-journal-of-cyber-policy.pdf).

**The -yse set is unconditional,** in both Oxford and general British, because
the root is Greek *lysis* and not `-izein`. There is no Oxford exception
([hull-awe.org.uk](http://hull-awe.org.uk/index.php/-lyse_-_-lyze), citing
Hart's Rules: "there is therefore no parallel with -ize- words").

> analyse, catalyse, hydrolyse, paralyse, dialyse, electrolyse, breathalyse,
> psychoanalyse

## U5. Traps that break naive rules

**`-our` derivatives are irregular within British English.** This is a lookup
table, not a suffix regex.

| Suffix | Behaviour | Example |
|---|---|---|
| `-ary, -ous, -ific, -ious, -icidal, -igenic, -al, -imeter` | **Drop** the u | honorary, humorous, laborious, vigorous, colorimeter |
| `-s, -ed, -ing, -less, -ful, -ise, -able, -ist, -ism` | **Keep** the u | colourful, honourable, colourist |
| `-ant, -ation` | Optional | colo(u)ration |

**`meter` against `metre`.** British English keeps *meter* for the measuring
instrument and uses *metre* only for the SI unit
([metricationmatters.org](https://metricationmatters.org/docs/Spelling_metre_or_meter.pdf):
"All English-speaking nations agree that meter can be used for an instrument").
A blind `meter -> metre` corrupts every *gas meter*, *voltmeter* and
*speedometer*.

**Double-L is four-way asymmetric.**

| Case | UK | US |
|---|---|---|
| Before a vowel suffix | doubles: travelled, modelling, cancelled | single: traveled, modeling |
| Root `l` in a small closed set | single: enrol, instal, distil, instil, fulfil, skilful, wilful | doubles: enroll, install, fulfill, skillful |
| Before `-ment` | never doubles: enrolment, fulfilment, instalment | always doubles: enrollment, fulfillment |

So a rule that flags `fulfill` must also know `fulfilment`, and must not
"correct" `fulfilment` to `fulfillment`.

**`licence` and `practice` are a noun-verb split *inside* British English**, not
a dialect swap. Noun takes `-ce` (a driving licence, general practice); verb
takes `-se` (to license a doctor, to practise medicine). See
[Stroppy Editor](https://stroppyeditor.wordpress.com/2015/10/28/licence-or-license-practice-or-practise/).
Flagging `license` unconditionally produces wrong advice half the time.

**`sulfur` is the reverse trap.** The Royal Society of Chemistry adopted
*sulfur* in 1992 to match IUPAC and BSI followed in 1993
([Chemistry World](https://www.chemistryworld.com/opinion/sulfur-or-sulphur/3005631.article)).
Do not "correct" it to *sulphur* in a technical register.

**`fetus` is standard in UK biomedical usage**, 92.5 per cent of UK-indexed
papers per [the BMJ](https://blogs.bmj.com/bmj/2018/05/18/jeffrey-aronson-when-i-use-a-word-oe-ae-oe-ae-oh/),
even though *foetus* survives in lay British writing.

## U6. Sense pairs: report-only, always

Never blind-replace. Each of these is correct in one sense and wrong in another,
and only a reader knows which:

| Pair | The distinction |
|---|---|
| program / programme | A computer *program* stays `program` in UK English; a TV or event *programme* does not |
| meter / metre | Instrument against SI unit |
| disc / disk | A *disk* is magnetic or a hard disk; a *disc* is most other round things |
| story / storey | Narrative against floor of a building |
| tire / tyre | To weary against the wheel |
| draft / draught | Document version against beer, air or animals |
| check / cheque | Verify against the banking instrument |
| curb / kerb | Restrain against the edge of a pavement |
| licence / license | Noun against verb |
| practice / practise | Noun against verb |
| dialog / dialogue | A UI *dialog box* keeps the US form as a term of art |

## U7. The gazetteer: never touched

Proper nouns and organisation names carry their own spelling by charter, and a
spell rule has no standing to change them.

> World Health Organization (`-ize` by charter), International Labour
> Organization (`-our`), Department of Defense, Pearl Harbor, the Australian
> Labor Party, Rockefeller Center

Direct quotations are equally out of bounds, whatever they spell.

## U8. What a finding looks like

A UK finding carries a tier and, only in the top two tiers, a replacement:

| Tier | What lands here | Fix behaviour |
|---|---|---|
| `high-confidence-stylistic` | A VarCon-certified unconditional pair, outside every excluded span, with no gazetteer collision | Replacement offered, applied only under `--write` |
| `low-confidence-judgement` | Everything in U5, U6 and U7, plus anything a language pre-filter is unsure about | No replacement. Reported for a human to weigh |

Nothing in the UK layer is ever `certain-mechanical`. Spelling is not a
codepoint classification and no diff can prove it right.

## U9. What stays judgement-only forever

There is a genuine evidence gap here worth stating plainly. No published study
measures detector or linter false positives on British English specifically; the
best-known false-positive study,
[Liang et al. 2023 (*Patterns*)](https://arxiv.org/abs/2304.02819), found a 61.3
per cent average false-positive rate on TOEFL essays across seven detectors, all
human-written, which is what a vocabulary-driven rule does to a writer it was
not tuned for.

Until a UK human-prose corpus exists and a per-rule false-positive rate is
published against it, the honest position is that the sense-dependent half of
the UK layer is advice, not correction. The tier system encodes that rather than
relying on anyone remembering it.
