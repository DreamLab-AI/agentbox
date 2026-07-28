---
name: renaissance-architecture
description: First-principles architecture and UI/UX guidance for building genuinely new software rather than derivative "X-but-for-Y" work. Use when designing or architecting a feature, choosing a stack or framework, reviewing a design, or in strategy discussions — to check whether complexity is earned, tools fit the problem, and the thing is a creation not a commentary.
---

# Renaissance Architecture

Build genuinely new things. Not "X but for Y."

## Core Philosophy

The problem isn't modern tools. It's building **commentaries instead of creations**.

Medieval scholars wrote commentaries on Aristotle instead of new philosophy. We build Star Wars spin-offs instead of new sci-fi. We add AI to existing workflows instead of asking what workflows become possible.

**Renaissance architecture means:**
- First-principles thinking about WHAT to build
- Pragmatic choices about HOW to build it
- Creating new paradigms, not extending old ones
- Using modern tools to make genuinely new things possible

## The Core Question

When designing anything, ask:

**"Am I creating something new, or commenting on something that exists?"**

It isn't about rejecting modern tools — it's about using them to build genuinely new things, not just another variation on established patterns. Medieval scholars could only write commentaries because they believed truth was revealed in the past. We have no such limitation. We can create.

## Quick-path

1. **What genuinely new thing are we creating?** If the answer is "X but for Y", pause and ask whether Y actually needs X.
2. **Start with the simplest architecture that could work.** Add complexity only when pain is measurable, not theoretical.
3. **Do the tools serve the creation, or does the creation serve the tools?** Frameworks/cloud/microservices earn their place; they aren't defaults.
4. **Is it human-legible and recoverable?** Config a newcomer can read in 10 minutes; errors that teach; undo at the data layer.
5. **When you deviate from a default, write down why** — one sentence in a comment, ADR, or README.

**Quick-reference defaults:**

| Dimension | Default | Upgrade When |
|-----------|---------|--------------|
| Storage | SQLite | Concurrent writes, scale, features |
| Framework | Yes, if team knows it | Build from scratch if simpler |
| Cloud | Where genuinely needed | Don't assume, validate |
| Config | YAML/JSON, well-documented | - |
| Errors | Teaching messages | - |
| Loading | Spinners with honest progress | - |
| State | Visible, inspectable | - |
| Undo | Data-layer versioning | - |
| Complexity | Earned, not assumed | Document reasoning |

## When to use this skill

Reach for it when designing features, architecting software, brainstorming apps, choosing a stack, reviewing designs, or in strategy discussions — any moment where you're deciding *what* to build and *how much machinery* it deserves.

## Detailed guidance (on-demand references)

Load these when the decision at hand needs the full tables and rationale:

- **[references/architecture.md](references/architecture.md)** — the five architecture principles (simplicity, framework choices, human-legible systems, local-first, composition), cloud & infrastructure fit tables, threshold triggers, and justified exceptions.
- **[references/ui-ux.md](references/ui-ux.md)** — UI/UX philosophy: immediate feedback, visible state, spatial consistency, undo & recovery, respecting attention.
- **[references/anti-patterns.md](references/anti-patterns.md)** — what this rejects (derivative thinking, cargo-cult engineering, premature complexity, process-over-thinking) plus the design-review and solution-generation checklists.

## Anti-Dogma Clause

**These are defaults, not laws. Violate with documented reasoning.** Every principle here has valid exceptions — the goal isn't purity, it's intentionality. Premature complexity is technical debt with interest.

**Valid reasons to deviate:** team expertise strongly favours a different approach · business timeline requires a faster path · regulatory/compliance requirements · measured performance needs · user research contradicts an assumption.

**Invalid reasons to deviate:** "everyone does it this way" · "we might need it someday" · "the tutorial used this" · "it's best practice" (without understanding why).

When you deviate, write down why.
