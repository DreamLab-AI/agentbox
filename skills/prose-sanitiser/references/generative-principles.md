# Generative principles

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

- **Developers:** lead with the code or concrete problem; show implementation;
  discuss alternatives; link to repos.
- **QA / QE:** start with the testing challenge; show strategy not tools;
  include risk assessment; provide adaptable heuristics.
- **Leadership:** open with business impact; metrics that matter; connect
  technical decisions to outcomes; keep details concise.

## A5. Write from experience

Only write about what you have done in production. If exploring, say so. The
reader can tell when prose is generated from a vague middle distance rather
than from concrete recall.

## A6. Know the job of the piece

Before drafting, name the reader, the outcome, the register, and the source
material only this author can supply. The register decides what the piece owes
(an argument owes a disputable thesis; a guide owes correct steps; a reference
page may be neutral). Full framing and register table:
[editorial-method.md](editorial-method.md). For drafting with an
author's own material, use the perspective interview in
[review-and-cowrite.md](review-and-cowrite.md).
