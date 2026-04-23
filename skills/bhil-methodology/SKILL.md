---
name: bhil-methodology
description: >
  AI-first development methodology with specification-driven artifact traceability.
  PRD → SPEC → ADR → TASK → CODE → REVIEW → DEPLOY pipeline with AI-native ADRs
  (model selection, prompt strategy, agent orchestration), LLM evaluation suites,
  guardrails specifications, and sprint-driven workflows. Optimised for Claude Code
  and Ruflo/RuVector.
version: 1.0.0
author: Barry Hurd (BHIL)
tags:
  - methodology
  - specification
  - adr
  - prd
  - sprint
  - quality
  - ai-native
  - traceability
---

# BHIL AI-First Development Methodology

Specification-driven development methodology where artifacts flow through a traceable chain: **PRD → SPEC → ADR → TASK → CODE → REVIEW → DEPLOY**, with retrospectives feeding back into planning.

Core premise: *The bottleneck in AI-assisted development is not code generation — it is specification quality.*

## When to Use This Skill

- **Starting a new feature**: "create a PRD for X", "scaffold a feature", "new feature"
- **Architecture decisions**: "should we use model X or Y", "document this decision"
- **Sprint planning**: "plan the next sprint", "break this into tasks"
- **AI-specific decisions**: model selection, prompt strategy, agent orchestration patterns
- **Quality gates**: evaluation suites, guardrails specs, artifact validation
- **Traceability**: "trace this bug back to requirements", "impact analysis"

## When Not to Use

- For single-file quick fixes — use direct editing
- For code quality/testing execution — use `build-with-quality` (complementary, not competing)
- For pure code review without methodology — use `code-review-quality` or `sherlock-review`
- For SEO content — use `toprank`

## Artifact Chain

```
PRD-NNN (Product Requirement)
  └── SPEC-NNN (Technical Specification)
        ├── ADR-NNN (Architecture Decision — standard, model, prompt, or agent)
        └── TASK-NNN (Implementable Work Unit)
              └── Sprint S-NN (Planned Execution)
                    └── Code + Review + Deploy
                          └── Retrospective → next PRD cycle
```

Every artifact carries YAML frontmatter with parent/child IDs for machine-actionable traceability.

## Templates

| Template | Purpose | ID Format |
|----------|---------|-----------|
| `PRD-TEMPLATE.md` | Product requirements document | PRD-NNN |
| `SPEC-TEMPLATE.md` | Technical specification | SPEC-NNN |
| `ADR-MODEL-SELECTION.md` | LLM model choice with benchmarks, cost, re-eval triggers | ADR-NNN |
| `ADR-PROMPT-STRATEGY.md` | Prompting approach, versioning, quality thresholds | ADR-NNN |
| `ADR-AGENT-ORCHESTRATION.md` | Agent architecture patterns (swarm, mesh, pipeline) | ADR-NNN |
| `TASK-TEMPLATE.md` | Implementable work unit with acceptance criteria | TASK-NNN |
| `SPRINT-PLAN-TEMPLATE.md` | Sprint planning with velocity and capacity | S-NN |
| `EVAL-SUITE-TEMPLATE.yaml` | LLM evaluation configuration | — |
| `GUARDRAILS-SPEC-TEMPLATE.md` | Safety and guardrails specification | — |
| `PROMPT-REGISTRY.md` | Prompt versioning and tracking | PV-NNN |

## Guides

| Guide | Content |
|-------|---------|
| `00-getting-started.md` | 5-minute setup |
| `01-methodology-overview.md` | Philosophy and principles |
| `03-sprint-workflow.md` | Step-by-step sprint execution |
| `04-context-management.md` | Preventing context fragmentation |
| `05-ai-native-patterns.md` | LLM-specific development patterns |
| `07-ruflo-ruvector-setup.md` | Ruflo/RuVector integration |

## Tools

```bash
# Initialise a new project with BHIL structure
bash ~/.claude/skills/bhil-methodology/tools/init.sh

# Create a new ADR
bash ~/.claude/skills/bhil-methodology/tools/new-adr.sh "Use GPT-4o for embeddings"

# Validate all artifacts for completeness and traceability
bash ~/.claude/skills/bhil-methodology/tools/validate-artifacts.sh
```

## Integration with Other Skills

| Skill | Relationship |
|-------|-------------|
| `build-with-quality` | BWQ executes the code/test/review phases; BHIL provides the spec/ADR/traceability wrapper |
| `sparc-methodology` | SPARC's 5-phase model maps to BHIL's artifact chain (Spec=PRD+SPEC, Arch=ADR, Code=TASK) |
| `prd2build` | Generates docs from PRD; BHIL provides the PRD template and traceability |
| `wardley-maps` | Strategic analysis feeds into PRD and ADR context |
| `lazy-fetch` | Context management complements BHIL's context fragmentation prevention |

## Quality Framework

- **Specification quality** is the primary quality lever, not test coverage alone
- **Evaluation suites** (EVAL-SUITE-TEMPLATE.yaml) define LLM quality thresholds
- **Guardrails specs** separate safety concerns from functional requirements
- **Artifact validation** scripts check frontmatter completeness and link integrity
- **Retrospective feedback** closes the loop from deployment back to requirements

## Attribution

BHIL AI-First Development Toolkit by Barry Hurd (barryhurd.com). MIT License.
