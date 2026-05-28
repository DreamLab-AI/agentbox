---
name: prose-sanitiser
description: >
  Audit and fix AI writing tells in prose, markdown, and presentation content.
  Removes Claude/LLM fingerprints: em-dash overuse, "The X" heading pattern,
  negative parallelism, sycophantic filler, tier-1 slop vocabulary, and
  structural tells. Enforces UK English spelling. Use when writing public-facing
  content, presentations, documentation, articles, or any text that should read
  as human-authored. Invoke with: "sanitise this", "clean up the writing",
  "remove AI tells", "de-slop", "make this read human".
---

# Prose Sanitiser

Strip LLM writing fingerprints from text. Output should read as if written by a
competent human with opinions, not by a model hedging its way through a prompt.

UK English throughout. No exceptions.

---

## Audit Checklist

Work through every item. Fix in-place. Do not add explanatory comments.

### 1. Em Dash (—) Density

**Rule:** Maximum 2 per 500 words in prose. Zero in lists.

Replace with:
- Comma (most cases)
- Full stop + new sentence (if the clause is independent)
- Colon (if introducing an explanation)
- Parentheses (if genuinely parenthetical)

Acceptable uses: attribution lines, dialogue interruption, deliberate rhetorical
pause in a presentation heading.

### 2. "The" Heading Disease

**Rule:** Never start a heading with "The" unless it's a proper noun ("The
Guardian", "The Loop").

| Before | After |
|--------|-------|
| The Problem: AI Is Hard | AI Is Hard |
| The Uncomfortable Question | One Awkward Question |
| The VisionClaw Stack | VisionClaw Stack |
| The 80/10 Gap | 80/10 Gap |

### 3. Negative Parallelism

**Rule:** Kill "not X — Y" and "not X, but Y" constructions.

| Before | After |
|--------|-------|
| It's not a feature — it's the foundation | It's the foundation, not a feature |
| Not just fast, but revolutionary | Fast. Actually fast. |
| This isn't about X. It's about Y. | This is about Y. |

Invert: lead with the positive claim. Or just delete the negative half.

### 4. Tier 1 Banned Vocabulary

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

### 5. Tier 2 Cluster Words

Not banned individually, but flag if 3+ appear in a single section:

crucial, notable, noteworthy, remarkable, fascinating, profound, compelling,
intriguing, elegant, meticulous, intricate, deliberate, thoughtful,
sophisticated, sprawling, bustling, evocative, poignant, cornerstone, linchpin,
bedrock, nexus, interplay, realm, arena, sphere, endeavour, myriad, plethora

### 6. Throat-Clearing Openers

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

### 7. Sycophantic Filler

**Delete entirely:**

- "You're absolutely right"
- "Great question"
- "That's a really interesting point"
- "Certainly!"
- "Absolutely!"
- "I'd be happy to help"

### 8. Structural Tells

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

### 9. Transition Word Overuse

Flag if more than 2 per page:

Furthermore, moreover, additionally, consequently, notably, crucially,
importantly, ultimately, fundamentally, indeed, significantly, subsequently,
accordingly

Replace with: nothing (just start the next sentence), or a concrete connector
that adds information.

### 10. Passive Voice

**Rule:** Active by default. Passive only when the actor is genuinely unknown or
irrelevant.

| Before | After |
|--------|-------|
| It can be seen that... | This shows... |
| The decision was made to... | We decided to... |
| The system is designed to... | The system does... |

### 11. UK English Spelling

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

## Output Format

Return the cleaned text with no commentary. If asked for a report, list changes
as a diff-style summary after the cleaned text.

## When NOT to sanitise

- Direct quotes from other people (blockquotes)
- Code, terminal output, API responses
- Proper nouns and product names
- Technical terms of art (even if they overlap with the banned list)
- Content the user explicitly flags as intentional
