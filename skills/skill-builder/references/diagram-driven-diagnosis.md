# Diagram-Driven Diagnosis

> Complex multi-function bug or suspected parallel implementations in a
> skill under construction? Use this method.

Use when: a bug or design defect spans many functions or modules; you
suspect duplicate or parallel implementations of the same concern (multiple
writers, divergent validators, shadow copies of an algorithm); or
symptom-chasing is not converging on root cause.

## Phase 1 — Cartography

Spawn N Sonnet agents, one per concern. Each agent renders its slice of the
system as a renderable Mermaid sequence or flow diagram built **from the
actual code, not from docs**. Concerns are domain-specific -- for example:
settings flow, data population and socket handoff, interaction events,
update and backoff logic, data types, GPU physics, analysis/clustering.

Each agent maps **all** code paths into its diagram and explicitly flags any
parallel or duplicate implementation it finds.

## Phase 2 — Queen Synthesis

One Opus coordinator collates the diagrams into a single ranked anomaly
register (e.g. `00-anomaly-register.md`) containing:
- a Mermaid mindmap of anomaly themes
- a revert-vs-reconcile table for each duplication
- git archaeology identifying the commit that introduced each divergence

## Phase 3 — QE Fleet

Brief QE agents to write **failing repro tests** that depend only on the
model/pure layer (no GPU, no network) to prove each anomaly objectively
before any fix is attempted. This converts "I suspect X" into a red test.

## Phase 4 — Fix with Live Diagrams

Implement fixes (deleting or deprecating parallel paths where they are not
integrated), updating each Mermaid diagram as you go so resolutions visibly
click into place. The red repro tests flip green as proof.

**Why it works:** forcing every parallel implementation into one visible
artefact makes divergent authorities obvious -- for example, one layer reads
`metadata.type` while another reads a top-level `type` field. Failing repro
tests prevent symptom-chasing and premature hacks.
