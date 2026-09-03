# Destructive audit

The mechanical catalogue. Work through every item. Fix in place. Do not add
explanatory comments.

## How to run it

```bash
slop-scan <path>                   # human report plus slop score
slop-scan <path> --severity high   # strongest signals only
slop-scan <path> --format sarif    # machine-readable, for GitHub code scanning
slop-scan <path> --explain-rules   # the rule table, with tiers and sources
```

Exit codes: **0** clean, **1** findings reported, **2** tool error. Format is
one flag, `--format {text,json,jsonl,sarif}`, with `--json` kept as an alias.
Suppress a deliberate choice with `slop-ignore` on the line (an HTML comment
works in Markdown).

Every finding carries a severity **and** a confidence tier, and they are
orthogonal. Severity says how strongly the tell signals AI authorship, so it
tells you where to spend effort. Confidence says whether the rule is right, and
it is the only thing that gates a fix. Everything in this file is
`low-confidence-judgement`: it is a prompt to look, never a verdict, and
`--write` will not touch any of it. A rule can be high-severity and still be a
guess.

The catalogue is a detector, not a target. Read the "do not launder slop into
new slop" section of SKILL.md before applying any replace-with column
mechanically.

## B1. Em Dash (—) Density

**Rule:** Maximum 2 per 500 words in prose. Zero in lists.

Replace with:
- Comma (most cases)
- Full stop + new sentence (if the clause is independent)
- Colon (if introducing an explanation)
- Parentheses (if genuinely parenthetical)

Acceptable uses: attribution lines, dialogue interruption, deliberate rhetorical
pause in a presentation heading.

## B2. "The" Heading & Opener Disease

**Rule (headings):** Never start a heading with "The" unless it's a proper noun
("The Guardian", "The Loop").

| Before | After |
|--------|-------|
| The Problem: AI Is Hard | AI Is Hard |
| The Uncomfortable Question | One Awkward Question |
| The VisionFlow Stack | VisionFlow Stack |
| The 80/10 Gap | 80/10 Gap |

**Rule (openers, HIGH):** Do not open a sentence, paragraph, list item, figure
caption or table cell with "The &lt;lowercase noun&gt;". It is the model's default
definitional throat-clear ("The production-node paired study measures...", "The
measured design choices follow...", "The system is a served node...") and it
stacks: dozens per document, all in the same cadence, none in a human's voice.
Recast so the real subject or action leads. A capitalised proper noun after "The"
(The Loom, The Guardian) is fine and is left alone.

| Before | After |
|--------|-------|
| The production-node paired study lifts quality by +0.27. | Holding the model fixed and varying only the serving path lifts quality by +0.27. |
| The measured design choices follow from deployment requirements. | Each design choice follows from a deployment requirement. |
| The fallback is disabled by default. | Semantic fallback stays off by default. |
| The system is a served node operating over a corpus. | A served node operates over the corpus. |

The scanner flags line-initial `The` + a lowercase word (`the-opener`, HIGH). It
cannot see mid-paragraph sentence openers; those need the human read.

## B3. Negative Parallelism

**Rule:** Kill "not X — Y" and "not X, but Y" constructions.

| Before | After |
|--------|-------|
| It's not a feature — it's the foundation | It's the foundation, not a feature |
| Not just fast, but revolutionary | Fast. Actually fast. |
| This isn't about X. It's about Y. | This is about Y. |

Invert: lead with the positive claim. Or just delete the negative half.

## B4. Tier 1 Banned Vocabulary

> `honest` / `honestly` / `honesty` is Tier 1 at HIGH weight: prose that keeps telling the reader it is honest is a hallmark AI tell. Transparent work shows its receipts and never says the word. Repair by deleting the claim and letting the disclosed method carry it; at most one load-bearing use per document.

Flag and replace every instance:

| Kill | Replace with |
|------|-------------|
| delve | look at, examine, dig into |
| leverage | use |
| robust | solid, reliable, sturdy |
| seamless | smooth, clean |
| comprehensive | thorough, full, complete |
| cutting-edge | current, recent, new |
| transformative | (delete or be specific about what changed) |
| groundbreaking | new, first |
| innovative | (delete: show don't tell) |
| holistic | (delete or say "whole-system") |
| testament | proof, evidence, sign |
| tapestry | (delete: almost always slop) |
| vibrant | (be specific: what colour, what energy?) |
| utilize | use |
| harness | use |
| unlock | enable, open |
| unleash | release, enable |
| streamline | simplify, speed up |
| empower | enable, let, give |
| elevate | raise, improve |
| paradigm | model, approach |
| unprecedented | new, first, unusual |
| synergy | (delete) |
| optimize | improve, tune |
| foster | support, grow |
| underscore | show, highlight |
| navigate (figurative) | deal with, work through |
| ecosystem (when not biological) | system, network |
| deep dive | close look |
| game-changing | (delete or be specific) |
| enterprise-scale | production-grade, serious, large |
| enterprise-grade | production-grade |
| extraordinary | (delete or be specific) |

## B5. Tier 2 Cluster Words

Not banned individually, but flag if 3+ appear in a single section:

crucial, notable, noteworthy, remarkable, fascinating, profound, compelling,
intriguing, elegant, meticulous, intricate, deliberate, thoughtful,
sophisticated, sprawling, bustling, evocative, poignant, cornerstone, linchpin,
bedrock, nexus, interplay, realm, arena, sphere, endeavour, myriad, plethora

## B6. Throat-Clearing Openers

**Delete entirely:**

- "In today's rapidly evolving..."
- "In the world of..."
- "Here's the thing:"
- "Let me be clear:"
- "It turns out..."
- "Let's dive in / explore / unpack"
- "It's worth noting that..."
- "It's important to note that..."
- "At its core..."
- "At the end of the day..."
- "When it comes to..."

## B7. Sycophantic Filler

**Delete entirely:**

- "You're absolutely right"
- "Great question"
- "That's a really interesting point"
- "Certainly!"
- "Absolutely!"
- "I'd be happy to help"

## B8. Hedge Words

Flag and usually cut:

basically, actually, probably, essentially, fundamentally, very, really,
quite, perhaps, somewhat

If a claim needs a hedge, replace with a specific qualifier ("in the staging
environment", "for payloads under 10KB").

## B9. Structural Tells

**Check and fix:**

- **Rule of three:** If you have exactly 3 items in every list, vary it. Real
  writing has 2s, 4s, and 7s.
- **Uniform paragraph length:** Vary it. Short paragraphs hit harder.
- **Tell-show-summarise:** Delete the summary sentence at the end of each
  section. The reader just read it.
- **Stacked rhetorical questions:** Maximum 2 in sequence. Better: 1 question,
  then answer it.
- **Bold-label bullets:** Not every bullet needs a **Bold Term:** prefix.
  Reserve for reference material.
- **Copula substitution:** "serves as a" → "is". "marks the" → "is".

## B10. Transition Word Overuse

Flag if more than 2 per page:

Furthermore, moreover, additionally, consequently, notably, crucially,
importantly, ultimately, fundamentally, indeed, significantly, subsequently,
accordingly

Replace with: nothing (just start the next sentence), or a concrete connector
that adds information.

## B11. Passive Voice

**Rule:** Active by default. Passive only when the actor is genuinely unknown or
irrelevant.

| Before | After |
|--------|-------|
| It can be seen that... | This shows... |
| The decision was made to... | We decided to... |
| The system is designed to... | The system does... |

## B12. UK English Spelling

Enforce throughout. The unconditional cases:

| US | UK |
|----|-----|
| optimize | optimise |
| organize | organise |
| color | colour |
| behavior | behaviour |
| center | centre |
| defense | defence |
| analyze | analyse |
| catalogue | catalogue (never *catalog*) |

**Do not extend this table by pattern.** A short list of near-neighbours are
traps, not rules:

- `license` is a noun-verb split *inside* British English, not a dialect swap. A
  driving *licence*, but to *license* a doctor. Same for *practice* and
  *practise*.
- `meter` is correct British English for an instrument. Only the SI unit is
  *metre*, so a gas meter and a voltmeter stay as they are.
- `fulfil` is UK, but *fulfilment* takes one `l` while US *fulfillment* takes
  two. The `-ment` rule inverts the doubling rule.
- `program` stays *program* for software; only a TV or event *programme* changes.
- `sulfur` is correct in a technical register (RSC 1992, BSI 1993). Do not
  "correct" it.
- `dialog box` is a UI term of art and keeps the US form.
- Organisation names carry their own spelling by charter: *World Health
  Organization*, *International Labour Organization*, *Department of Defense*.

Full data source, the `--oxford` flag, span exclusion, the always-ise and
always-yse sets, and the complete sense-pair and gazetteer lists are in
[uk-english.md](uk-english.md). The scanner reports every one of these as
judgement-only and offers no automatic replacement, because roughly half of the
naive matches would be wrong.

## B13. Claudish Structural Patterns

Patterns specific to Claude-style AI prose that survive Tier 1 vocabulary removal.
These are the second-order tells: the sentence shapes, connective habits, and
rhetorical tics that persist even after the banned words are gone. Inspired by
the [claudish-to-english](https://github.com/gvzdv/claudish-to-english) project.

### B13.1 Filler Openers (non-throat-clearing)

Beyond B6's throat-clearing, Claude favours these mid-text fillers:

| Kill | Replace with |
|------|-------------|
| Let's break this down | (delete: just start explaining) |
| There are several key aspects/considerations | (delete: list the aspects directly) |
| This is particularly important/relevant | (delete: if it's important, show why) |
| It's also worth mentioning/highlighting | (delete: just mention it) |
| Here is where things get interesting | (delete: the reader will decide) |

### B13.2 False Dichotomy Framing

"Whether you're X or Y" constructions create a faux-inclusive frame that
addresses nobody. "In other words" and "put simply" are condescending rewrites
of what was just said.

| Kill | Replace with |
|------|-------------|
| Whether you're a beginner or an expert | (delete: write for your actual audience) |
| Think of it as... | (delete: just describe the thing) |
| In other words | (delete: rewrite the original to be clear the first time) |
| Put simply / Put differently | (delete: say it clearly once) |
| To put it in perspective | (delete: the perspective should be self-evident) |

### B13.3 Simplification as a Rewrite Strategy

When the goal is readability rather than watermark evasion, a plain-English
simplification pass is often more effective than paraphrasing. The `simplify`
and `declaudish` rewrite strengths target this directly:

```bash
rewrite-text <path> --strength simplify      # plain English, short sentences
rewrite-text <path> --strength declaudish     # targets Claude-specific tells
rewrite-text <path> --strength simplify --context "What does our auth system do?"
```

The `--context` flag injects the original question or prompt (truncated to 800
chars) into the rewrite prompt, helping the model make better simplification
choices by understanding what the prose is trying to answer. Works with any
strength, most useful with `simplify` and `declaudish`.

## B14. Insider voice in external documents (audience leakage)

A class of tell specific to documents that cross an organisational boundary: client
deliverables, partner correspondence, published specs. The text narrates the *author's
side* of a relationship instead of the shared subject: negotiation stance, critique of
the counterparty's drafting, strategic framing that only makes sense to the sending
team.

Symptoms:
- Headings or sentences that characterise the other party's text: "a decision the
  wording leaves to X", "parts of the suite read as though", "the spec quietly
  reassigns".
- Adversarial-lawyer constructions: "on any reading we can construct", "keeps that
  freedom open", "worth being clear-eyed on".
- Suspicion framing of future behaviour: "later versions do not silently become the
  baseline", "so the price and roadmap stay honest with each other".
- Internal risk vocabulary escaping: "landmine", "scope creep", "the trap", "smuggled
  in".

The fix is not softening; it is re-aiming. Describe the decision, mechanism or rule
neutrally, as a property of the shared system rather than a move in a negotiation:
"a decision the wording leaves to X" → "an interpretation for X's approval"; "do not
silently become the baseline" → "take effect only through change control, so the
baseline and the document set stay aligned".

Audience judgement is required: these phrases are often *correct* in internal memos and
risk registers. The scanner flags them at medium severity; keep or kill by asking who
the reader is. When one document family has both internal and external variants, sweep
the external one after every edit pass, because insider lines migrate in during rewrites.

## B15. Preamble setup labels (announcing the explanation)

Headings and openers that promise clarity instead of delivering it: "In plain terms",
"Put simply", "Simply put", "In essence", "In a nutshell", "At a high level", "In other
words", "To put it another way". As a heading, the label frames the following paragraph
as a translation of something harder, which either insults the surrounding prose (why
wasn't *it* plain?) or pads the structure. As a sentence opener, it is throat-clearing
before the actual claim.

The fix is deletion, not substitution: the plain statement should simply be the text,
placed where the label was. If a section genuinely needs a lay summary and a formal
treatment, name the content, not the register: "Rule" and "Behaviour" beat "In plain
terms" and "The maths". The one legitimate use is contrast a reader needs flagged
(e.g. translating a quoted legal clause immediately after quoting it); even then,
prefer a colon after the quote to a labelled sub-heading.
