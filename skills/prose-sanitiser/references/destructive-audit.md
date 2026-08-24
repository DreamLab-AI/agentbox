# Section B — Destructive Audit

Work through every item. Fix in-place. Do not add explanatory comments.

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

**Rule (openers — HIGH):** Do not open a sentence, paragraph, list item, figure
caption or table cell with "The &lt;lowercase noun&gt;". It is the model's default
definitional throat-clear ("The production-node paired study measures...", "The
measured design choices follow...", "The system is a served node...") and it
stacks — dozens per document, all in the same cadence, none in a human's voice.
Recast so the real subject or action leads. A capitalised proper noun after "The"
(The Loom, The Guardian) is fine and is left alone.

| Before | After |
|--------|-------|
| The production-node paired study lifts quality by +0.27. | Holding the model fixed and varying only the serving path lifts quality by +0.27. |
| The measured design choices follow from deployment requirements. | Each design choice follows from a deployment requirement. |
| The fallback is disabled by default. | Semantic fallback stays off by default. |
| The system is a served node operating over a corpus. | A served node operates over the corpus. |

The scanner flags line-initial `The` + a lowercase word (`the-opener`, HIGH). It
cannot see mid-paragraph sentence openers — those need the human read.

## B3. Negative Parallelism

**Rule:** Kill "not X — Y" and "not X, but Y" constructions.

| Before | After |
|--------|-------|
| It's not a feature — it's the foundation | It's the foundation, not a feature |
| Not just fast, but revolutionary | Fast. Actually fast. |
| This isn't about X. It's about Y. | This is about Y. |

Invert: lead with the positive claim. Or just delete the negative half.

## B4. Tier 1 Banned Vocabulary

> `honest` / `honestly` / `honesty` is Tier 1 at HIGH weight: prose that keeps telling the reader it is honest is a hallmark AI tell — transparent work shows its receipts and never says the word. Repair by deleting the claim and letting the disclosed method carry it; at most one load-bearing use per document.

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
| innovative | (delete — show don't tell) |
| holistic | (delete or say "whole-system") |
| testament | proof, evidence, sign |
| tapestry | (delete — almost always slop) |
| vibrant | (be specific — what colour, what energy?) |
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

Enforce throughout:

| US | UK |
|----|-----|
| optimize | optimise |
| organize | organise |
| color | colour |
| behavior | behaviour |
| center | centre |
| license (noun) | licence |
| defense | defence |
| analyze | analyse |
| catalog | catalogue |
| fulfill | fulfil |

## B13. Claudish Structural Patterns

Patterns specific to Claude-style AI prose that survive Tier 1 vocabulary removal.
These are the second-order tells: the sentence shapes, connective habits, and
rhetorical tics that persist even after the banned words are gone. Inspired by
the [claudish-to-english](https://github.com/gvzdv/claudish-to-english) project.

### B13.1 Filler Openers (non-throat-clearing)

Beyond B6's throat-clearing, Claude favours these mid-text fillers:

| Kill | Replace with |
|------|-------------|
| Let's break this down | (delete — just start explaining) |
| There are several key aspects/considerations | (delete — list the aspects directly) |
| This is particularly important/relevant | (delete — if it's important, show why) |
| It's also worth mentioning/highlighting | (delete — just mention it) |
| Here is where things get interesting | (delete — the reader will decide) |

### B13.2 False Dichotomy Framing

"Whether you're X or Y" constructions create a faux-inclusive frame that
addresses nobody. "In other words" and "put simply" are condescending rewrites
of what was just said.

| Kill | Replace with |
|------|-------------|
| Whether you're a beginner or an expert | (delete — write for your actual audience) |
| Think of it as... | (delete — just describe the thing) |
| In other words | (delete — rewrite the original to be clear the first time) |
| Put simply / Put differently | (delete — say it clearly once) |
| To put it in perspective | (delete — the perspective should be self-evident) |

### B13.3 Simplification as a Rewrite Strategy

When the goal is readability rather than watermark evasion, a plain-English
simplification pass is often more effective than paraphrasing. The `simplify`
and `declaudish` rewrite strengths target this directly:

```bash
python3 rewrite_text.py <path> --strength simplify      # plain English, short sentences
python3 rewrite_text.py <path> --strength declaudish     # targets Claude-specific tells
python3 rewrite_text.py <path> --strength simplify --context "What does our auth system do?"
```

The `--context` flag injects the original question or prompt (truncated to 800
chars) into the rewrite prompt, helping the model make better simplification
choices by understanding what the prose is trying to answer. Works with any
strength, most useful with `simplify` and `declaudish`.
