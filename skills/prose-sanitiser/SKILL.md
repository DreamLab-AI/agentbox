---
name: prose-sanitiser
description: >
  Audit and fix AI writing tells in prose, markdown, presentation content, and
  fiction. Removes Claude/LLM fingerprints at three levels: lexical (banned
  vocabulary, hedge words), structural (em-dash density, "The X" headings,
  negative parallelism, throat-clearing, transition overuse), and narrative
  (thematic over-explanation, embodied-emotion overuse, single-track plots,
  tidy resolutions, vague allusions, no fourth-wall breaks). Also provides
  generative principles for writing fresh prose that does not need sanitising.
  Enforces UK English spelling. Use when writing or editing public-facing
  content, presentations, documentation, articles, blog posts, tutorials, or
  short fiction. Invoke with: "sanitise this", "clean up the writing",
  "remove AI tells", "de-slop", "make this read human", "write a blog post",
  "draft technical content".
---

# Prose Sanitiser

Strip LLM writing fingerprints from text. Output should read as if written by a
competent human with opinions, not by a model hedging its way through a prompt.

UK English throughout. No exceptions.

Two modes:
- **Generative** — apply Section A principles when drafting new content.
- **Destructive** — run the Section B audit on existing text.

## Mechanical pre-pass: the scanner

`scripts/slop_scan.py` catches the mechanical tells (Tier-1 vocab, "The X"
headings, negative parallelism, throat-clearing, hedge words, US spelling,
em-dash and transition density) before you read for the ones a regex cannot
see. Run it first, fix in priority order, then do the human read for Section C
and for voice.

```bash
python3 scripts/slop_scan.py <path>                 # full report + slop score
python3 scripts/slop_scan.py <path> --severity high # only the strongest signals
python3 scripts/slop_scan.py <path> --json          # machine-readable, for CI
```

It scans `.md .markdown .mdx .txt .rst`, skips fenced code and blockquotes,
respects the `slop-ignore` marker (see below), and reports each finding with
`file:line` and the fix. The exit code is the high-severity count, so CI can
gate a docs build on it. The scanner sees lexical and structural tells only; it
is blind to narrative defaults, altitude, and whether a sentence is actually
true. Those are still yours.

## Don't launder slop into a new slop (second-order defaults)

The failure mode of every de-slop pass is swapping one default for another. Kill
every "leverage" and the prose acquires a different fingerprint: uniform
"use", staccato two-word fragments ("Fast. Actually fast."), the same inverted
"X, not Y" cadence on every other line, hedges amputated until the voice reads as
clipped and machine-confident. An editor can clock a *de-slopped-by-AI* draft as
fast as a slopped one. The replacement vocabulary, applied mechanically, is a
tell.

So the rules below are a detector, not a target. The replace-with column is a
prompt to make a choice, not a lookup table to apply on autopilot. The only
durable property is the one a default can never have: a wording you chose for
this sentence and can say why. Vary the repair. Sometimes "leverage" wants
"use", sometimes "lean on", sometimes the clause should be cut. If a fix
introduces a new uniform default, it is not a fix.

---

# Section A — Generative Principles

Use when writing fresh content. Following these means less to fix later.

## A1. Lead with value

The first 30 seconds decide whether the reader keeps going. Open with the
specific thing they will learn, the concrete problem, or the result. Cut every
warm-up sentence.

| Bad | Good |
|-----|------|
| "In today's rapidly evolving landscape..." | "Here's how we cut bug-detection time from 4 days to 2 hours." |
| "This article will explore..." | "We replaced our test runner. CI is 40% faster. Trade-offs below." |

## A2. Show, don't tell

Specifics beat adjectives. Numbers, names, code, before/after.

| Bad | Good |
|-----|------|
| "We improved testing." | "Bug detection: 12 → 47 per sprint." |
| "Performance improved." | "Response time: 2.3s → 180ms." |
| "Better collaboration." | "Devs now ask QE for input during story refinement." |

## A3. Honest trade-offs

Real writing names what is lost as well as gained. AI prose tends to claim
"best of both worlds." Don't.

> "TDD slowed velocity 20% in the first month. Bugs in production dropped 75%
> over the next quarter."

## A4. Audience framing

Adjust the opening, the level of detail, and the takeaway:

- **Developers** — lead with the code or concrete problem; show implementation;
  discuss alternatives; link to repos.
- **QA / QE** — start with the testing challenge; show strategy not tools;
  include risk assessment; provide adaptable heuristics.
- **Leadership** — open with business impact; metrics that matter; connect
  technical decisions to outcomes; keep details concise.

## A5. Write from experience

Only write about what you have done in production. If exploring, say so. The
reader can tell when prose is generated from a vague middle distance rather
than from concrete recall.

---

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

## B2. "The" Heading Disease

**Rule:** Never start a heading with "The" unless it's a proper noun ("The
Guardian", "The Loop").

| Before | After |
|--------|-------|
| The Problem: AI Is Hard | AI Is Hard |
| The Uncomfortable Question | One Awkward Question |
| The VisionFlow Stack | VisionFlow Stack |
| The 80/10 Gap | 80/10 Gap |

## B3. Negative Parallelism

**Rule:** Kill "not X — Y" and "not X, but Y" constructions.

| Before | After |
|--------|-------|
| It's not a feature — it's the foundation | It's the foundation, not a feature |
| Not just fast, but revolutionary | Fast. Actually fast. |
| This isn't about X. It's about Y. | This is about Y. |

Invert: lead with the positive claim. Or just delete the negative half.

## B4. Tier 1 Banned Vocabulary

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

---

# Section C — Narrative Tells (Fiction)

Apply when sanitising short stories, novel passages, character-driven scenes,
or any narrative prose. Lexical fixes are not enough: AI fiction converges on a
narrow set of structural defaults. Source: Russell et al., *StoryScope*
(arXiv:2604.03136, 2026), parallel corpus of 61,608 stories across 5 LLMs and
human authors.

The percentages below are AI-vs-human rates from that study; treat them as a
strong prior, not a hard rule.

## C1. Thematic Over-Explanation

AI states the theme/moral explicitly 77% of the time vs. 52% for humans.
Narrators announce the lesson learned. Subplots tidily echo the main theme.

**Fix:** Delete the narrator's thematic commentary. Let the reader infer.
Allow subplots to drift. If a character's arc ends with stated insight,
either cut the statement or move it into ambiguous action.

| Slop | Repair |
|------|--------|
| "She realised, then, that grief was simply love with nowhere to land." | (delete the line — show the realisation through what she does next) |
| Narrator: "And so, in the end, he learned that..." | (cut entirely) |

## C2. Embodied Emotion Over Labels

AI conveys emotion through body 81% of the time vs. 38% for humans. Tight
throats, cold sweat, dimming light. Humans use explicit emotion labels 29%
of the time; AI only 8%.

**Fix:** Mix. Sometimes name the feeling ("she was furious"). Use bodily
sensation sparingly and only where it earns its place. Stop using setting as
mood mirror in every scene.

| Slop | Repair |
|------|--------|
| "A cold weight settled in his chest. The lamplight dimmed. The wallpaper seemed to lean in." | "He was scared." (or: a single concrete bodily detail, then move) |

## C3. Single-Track Plots

79% of AI stories have no subplots, vs. 57% for humans. Causal chains are
tight; loose ends are tied. Protagonists drive their own resolution 69% of
the time (vs. 46% human).

**Fix:** Introduce at least one subplot that does not resolve. Let an event
have multiple causes, some off-page. Let the resolution come partly from
chance, secondary characters, or refusal to act.

## C4. Tidy Resolutions, Especially Internal-Acceptance Endings

AI defaults to "the protagonist understands and accepts" (47% vs. 27%).
Epilogues are over-represented (a Claude fingerprint). Endings rarely
unsettle.

**Fix:** Cut the epilogue. End on the ambiguous beat. Let the protagonist
be wrong, or unchanged, or worse off. The reader does not need closure.

## C5. Linear Chronology

AI tells the story from first clue to grand reveal. Humans use flashbacks,
flash-forwards, and nonlinear framing far more often (anachrony intensity
2.58 vs. 2.31; nonlinear framing 1.96 vs. 1.68 on 1-5 scales).

**Fix:** Consider opening at the funeral and spiralling backward. Withhold
the inciting incident. Let a revelation force re-reading of earlier scenes.

## C6. Vague Allusions Over Named References

AI uses unnamed "implicit echoes" 72% of the time (vs. 50% human). It avoids
naming real brands, places, works, or people. Humans cite specific texts and
authors at nearly double the rate (47% vs. 24%).

**Fix:** Name the band, the pub, the novel, the brand of cigarette. Specificity
signals a human who lived in a world rather than a model trained on its
silhouette.

## C7. No Fourth-Wall Breaks

Humans break the fourth wall 67% of the time vs. 39% for AI; they address
the reader directly 28% vs. 7%.

**Fix:** If the voice permits it, let the narrator acknowledge the reader.
"You may think this was foolish. It was." Use sparingly.

## C8. Over-Engineered Sensory Description

AI over-indexes on olfactory imagery (82% vs. 57%) and lush sensory density
generally. Spatial granularity runs higher than human writing.

**Fix:** Drop most of the smell descriptions. Leave rooms partially undrawn.
Trust the reader's imagination to fill in walls, weather, light.

## C9. Philosophical-Debate Dialogue

AI characters debate ideas in dialogue 59% of the time (vs. 34% human).
Conversations become essays in disguise.

**Fix:** Cut philosophical exchanges. Replace with action, deflection, or
talking past each other. People rarely argue ideas cleanly; they argue
about who left the milk out.

## C10. Morally Clear Protagonists

Human stories have morally ambivalent protagonists 59% of the time; AI only
38%. AI heroes do the right thing for the right reasons.

**Fix:** Give the protagonist a petty motive alongside the noble one. Let
them be cruel in a small way. Decline to signal which choices are admirable.

## C11. Per-Model Fingerprints

If you know which model generated the draft, watch for:

| Model | Tell |
|-------|------|
| Claude | Flat event escalation; reverent toward literary tradition; epilogues; avoids dream sequences; "quiet endings". |
| GPT | Dream sequences; gossip/rumour as plot mechanism (64% vs. 44-55%); distant retrospective framing ("years later..."); ensemble casts. |
| Gemini | External character description as the introduction; bleak/oppressive settings (88%); tidy denouements; extended endings. |
| DeepSeek | Front-loaded context that humans would withhold. |
| Kimi | The generic centre — few distinctive choices, blandly competent. |

---

# Section D — Final Editing Checklist

Before publishing:

- [ ] Title promises something specific
- [ ] Opening hooks in 30 seconds (no warm-up)
- [ ] Every claim is backed by a specific example, number, or quote
- [ ] All Tier 1 vocabulary removed
- [ ] Em-dash count under threshold; no em-dashes in lists
- [ ] No "The X" headings (unless proper noun)
- [ ] No negative parallelism
- [ ] No throat-clearing openers
- [ ] UK English consistent throughout
- [ ] (Fiction) at least one subplot doesn't tidily resolve
- [ ] (Fiction) at least one emotion labelled directly
- [ ] (Fiction) at least one named real-world reference
- [ ] Would send to a respected colleague without an apology

---

## Output Format

Default: return the cleaned text with no commentary.

If asked for a report (or running an audit), lead with the verdict, not the
findings:

1. **Verdict and the single highest-impact change.** One line: the slop score
   and verdict from the scanner, then the one fix that matters most.
2. **Findings by priority**, each with `file:line`, the tell, and the fix.
   High-severity first. Quote the offending span, not the whole paragraph.
3. **Close with the slop score and the top three changes.** Plain and specific.

The goal is prose a person decided the wording of, which is the one thing the
scanner cannot do for them. State what is mechanical (the scanner found it) and
what needed a human read (Section C, voice, truth).

## When NOT to sanitise

- Direct quotes from other people (blockquotes — the scanner already skips these)
- Code, terminal output, API responses (the scanner skips fenced blocks)
- Proper nouns and product names
- Technical terms of art (even if they overlap with the banned list)
- Content the user explicitly flags as intentional
- Stylistic choices that violate a rule but serve the piece (e.g. a deliberately
  philosophical dialogue in a Socratic essay)

**Marking intentional choices.** Put `slop-ignore` on a line (an HTML comment
`<!-- slop-ignore -->` works in markdown) and the scanner skips it. Use it when
a flagged word is a real decision, so the audit stays trustworthy and does not
nag about a chosen term. A line you have to mark is a line you have made a
choice about — which is the whole point.
