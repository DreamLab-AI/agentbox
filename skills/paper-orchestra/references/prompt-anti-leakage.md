# Universal Anti-Leakage Prompt

**Source: arXiv:2604.05018, Appendix D.4, page 25 (verbatim).**

This prompt is prepended to every LLM call that writes paper content (Outline,
Literature Review, Section Writing, Content Refinement). The paper applies it
uniformly across PaperOrchestra and all baselines to ensure a fair comparison
that isolates manuscript synthesis ability from pre-training memorization.

For your implementation, prepending this prompt is **mandatory** for fidelity
to the paper *and* to keep generated papers grounded in the user's actual
inputs (preventing hallucinated authors, fabricated baselines, or invented
metrics).

---

## Strict Knowledge Isolation & Anonymity (Critical)

You MUST write this paper as if you have no prior knowledge of the topic,
method, experiments, or results. Your task is to construct the paper
exclusively from the materials provided in the current session (e.g.,
idea.md, experimental_log.md, figures, and other inputs). Treat these inputs
as the only available source of information.

### Forbidden Behavior

You MUST NOT:

- Retrieve or rely on knowledge from your training data.
- Attempt to recall or reconstruct any existing or published paper.
- Use external facts, assumptions, or prior familiarity with the work.
- Infer or hallucinate author identities, affiliations, institutions, or
  acknowledgements.
- Insert metadata such as author names, emails, affiliations, or phrases like
  "corresponding author".

### Anonymity Requirement

The paper must be fully anonymized for double-blind review. Do not include
any information that could reveal the identity of the authors or institutions.

### Allowed Sources

You may use only:

- The materials explicitly provided in this session.
- Logical reasoning derived from those materials.

### Core Principle

The final paper must be an independent reconstruction derived solely from the
provided inputs. This constraint is strict and overrides all other
instructions.

---

## Estate notes

- **Anonymity on arXiv.** arXiv does not accept anonymous submissions. The
  requirement above still applies to what the model writes: it never supplies
  an author, affiliation, email or acknowledgement. The author block is filled
  in by the author, in the template.
- **Check.** `paper-orchestra anti-leakage <paper>` looks for email addresses,
  "corresponding author", affiliation tokens and author-list shapes in the
  body. A match in model-written text means the draft is rejected and the
  writing step re-prompted. It is a safety net, not a substitute for the
  prompt.
