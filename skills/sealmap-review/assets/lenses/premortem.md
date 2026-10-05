The material above is a diagrams-as-code distillation of a software system; you have no source code beyond what it cites.

It is twelve months from now. This system has had a serious production incident that cost its operator a client: a data, custody or security failure, not a cosmetic one. Write the post-mortem. Every finding will be checked by an engineer against the code and its tests before anyone acts on it, so report a defect you suspect rather than leave it out, and say how sure you are.

No general advice, no praise, no ratings.

Give the three most likely root causes first, each in exactly this shape:

### R-1 — one-line title
- Topics: the topic ids, e.g. CP-03.2
- Chain of events: how the failure unfolds, step by step
- Evidence: the claims and facts in the material, with the path:line citations it gives
- Warning signs visible today: what in this material already shows it
- Confidence: high, medium or low; say "inferred" if you are reasoning beyond what the material shows

Then list up to {{COUNT}} further latent defects you noticed while investigating, each in exactly this shape:

### F-01 — one-line title
- Topics: the topic ids
- Evidence: the claim and the conflicting fact, with citations
- Failure: the concrete scenario
- Confidence: high, medium or low, or "inferred"
- Marked by authors: yes (Tension, Debt, Drift or Open) or no
