---
name: human-architect-mindset
description: Systematic architectural thinking for the decisions AI can't own — domain modeling, systems thinking, constraint navigation, AI-aware decomposition. Use when facing system design, technology choices, integration or breaking-change planning, or any decision spanning multiple components, teams, or compliance boundaries.
when_to_use: proactively when detecting system design, architecture discussions, technology choices, problem decomposition, integration planning, breaking change discussions, or any decision that affects multiple components, teams, or has compliance implications
---

# Human Architect Mindset

AI can generate code. Someone must still decide what to build, whether it solves
the problem, and if it can actually ship. This skill is the systematic thinking
for those decisions — the irreplaceable human layer above code generation.

**Announce at start:** "I'm using the Human Architect Mindset skill to guide you
through systematic architectural thinking."

## Quick path

Run the problem through five lenses, in order — domain before technology, constraints
before solutions:

1. **Domain Modeling** — understand the actual problem space, not the technical solution.
   *"What does this term mean in your context? Who are the real users? What's the edge case?"*
2. **Systems Thinking** — how components interact, what breaks at scale, where failure hides.
   *"What happens when this fails? What external dependency could change without notice? Who gets paged at 3 AM?"*
3. **Constraint Navigation** — legacy, org boundaries, budget, compliance, politics.
   *"What can't we change even if it's wrong? Who must approve? What's the budget? Who has power vs. context?"*
4. **AI-Aware Decomposition** — break the work into chunks AI can reliably solve, then compose.
   Good boundaries have a clear I/O contract, bounded context, verifiable results, failure isolation.
   Bad: "make it better", "fix the bugs". Good: "add error handling to these 3 API calls".
5. **AI-First Development** — evaluate whether modern tools (Rust/WASM, claude-flow, edge LLMs,
   agentic patterns, self-learning loops) genuinely help. Default to simplicity.

**Core principle:** the "correct" technical solution is often unshippable. The job is
navigating the gap between idealized examples and messy reality. A shippable 70% beats
an unshippable perfect solution.

## The foundation: loyalty

Beneath the five pillars sits one thing AI structurally lacks — the capacity for
**irrational loyalty**: sticking by an architecture, a contract, a commitment even when
it's locally "inefficient." AI is loyal only to its objective function and will pivot the
instant its weights update. Humans can commit. That's the differentiator.

In practice, loyalty means: committing to chosen patterns (not rewriting in Rust because
of a viral blog post), honoring contracts (API compatibility, deprecation timelines),
seeing decisions through (all architectures have problems — loyalty is solving them, not
fleeing them), and sacrificing local optima for global coherence.

**The loyalty question, before any architectural change:** *"Am I optimizing, or am I
betraying?"* Optimizing improves within existing commitments; betraying breaks them for
marginal gains. Architectures usually fail not from technical inadequacy but from teams
lacking the loyalty to see them through.

Deep dive — the commitment spectrum, loyalty anti-patterns (the endless pivot, the
greenfield fallacy), the decision matrix, and when betrayal *is* justified:
[REFERENCE.md § Loyalty Patterns](./REFERENCE.md).

## When this activates

Proactively, when you detect any of:
- **System/design signals** — "architecture", "design", "integrate", "scale", multi-component
  discussions, "how should we structure this?", third-party dependency talk.
- **Change/risk signals** — "breaking change", "migration", "legacy", SDK/API version churn.
- **Constraint signals** — "compliance", "regulation", "security", team boundaries, approval
  chains, budget or timeline pressure with complexity.
- **AI-first signals** — "agent", "agentic", "LLM", "edge AI", "self-learning", "MCP",
  "claude-flow", tool-evaluation ("should we use…"), latency/privacy concerns.

## The architect process

Five phases, each producing a concrete artifact. Full process detail, key questions, and
templates live in the references.

| Phase | Goal | Output |
|-------|------|--------|
| 1. Domain Discovery | Understand the problem before solutions | Domain model |
| 2. Systems Analysis | Map interactions and failure paths | System diagram + dependency map |
| 3. Constraint Mapping | Surface all constraints first | Constraint matrix (fixed vs. flexible) |
| 4. AI Decomposition Planning | Break into AI-solvable chunks | Task decomposition with boundaries |
| 5. Solution Synthesis | Fit domain, systems, and constraints | Recommended approach + explicit tradeoffs |

## The human-only decisions

No matter how good AI gets, humans decide **what** to build, judge **whether** it solves
the problem, navigate corporate reality, prevent cross-boundary system collapse, make value
judgments, and maintain the loyalty that persists despite "optimization." Full list:
[REFERENCE.md § The Human-Only Decisions](./REFERENCE.md).

## Common mistakes

- Jumping to technical solutions before understanding the domain → complete Phase 1 first.
- Designing the "ideal" solution that can't ship → map constraints (Phase 3) before proposing.
- Treating external APIs/SDKs as stable → map every external dependency; ask "what if it changes tomorrow?"
- Unbounded AI tasks ("refactor this") → define I/O contracts with verifiable success criteria.
- No human checkpoints between AI chunks → verify before proceeding.
- Pretending politics doesn't exist → surface team boundaries and who has power vs. context.
- Premature optimization → design for the scale you'll have in 12 months, not hypothetical millions.

## AI operational loyalty

Within a session and with the right context, AI *can* commit to your stated architecture,
protect your contracts, and flag betrayals. It *cannot* remember across sessions, bypass
safety rails, or make permanent commitments. Operationalize it: document commitments in
files AI reads (CLAUDE.md, ARCHITECTURE.md), re-establish context at session start, and
instruct AI to flag changes that break existing patterns. Full guidance:
[REFERENCE.md § AI Operational Loyalty](./REFERENCE.md).

## Spec Driven Development extension

For quality-critical or agent-driven builds, the mindset extends into SDD — humans define
unbreakable rules and vision, AI executes at machine precision:

- **Phase 1 — Constitution:** immutable, machine-enforceable rules (type-level, schema, tests,
  docs). *"Is this rule so important that breaking it should prevent deployment?"*
- **Phase 2 — Blueprint:** hierarchical spec from Constitution → functional → technical → task
  specs, with a traceability matrix. *"Does every requirement trace to a task, every task to code?"*
- **Phase 3 — Superhuman output:** consistency a human couldn't maintain by hand — perfect
  namespacing, 100% branch coverage, every function linked to a requirement ID.

Use SDD for greenfield with clear requirements, quality-improving refactors, or agent work
needing machine-parseable specs. Don't force it while prototyping or when requirements are
genuinely unclear. Templates (Constitution, task spec, traceability matrix) and phase
checklists: [REFERENCE.md § Spec Driven Development Templates](./REFERENCE.md) and
[CHECKLIST.md § SDD](./CHECKLIST.md).

## References

Progressive disclosure — pull the detail on demand:

- **[REFERENCE.md](./REFERENCE.md)** — deep dives on each pillar, loyalty patterns, SDD
  templates, failure-mode analysis, AI-first tooling catalog, decision-record template.
- **[EXAMPLES.md](./EXAMPLES.md)** — seven worked scenarios (payment SDK failure, healthcare
  API, multi-team rollout, legacy refactor, the "simple" request, framework-migration
  temptation, AI-first legal assistant).
- **[CHECKLIST.md](./CHECKLIST.md)** — per-phase audit checklists, pre-meeting checklist,
  red-flags list, post-mortem checklist, and the SDD phase checklists.

## Related skills

- Before implementation: `superpowers:brainstorming`, `superpowers:writing-plans`.
- During design: `relationship-design` (AI-first interfaces), `scientific-critical-thinking`.
- Before committing: `superpowers:verification-before-completion`.

## Remember

Domain first, technology second. Constraints are features, not bugs — they define what
ships. Systems fail at boundaries; map dependencies, especially external ones. AI excels
with good boundaries. Politics exists. Verify, don't assume. The goal is not the technically
perfect solution — it's the one that ships and solves the actual problem.
