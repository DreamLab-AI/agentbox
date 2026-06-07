---
name: "Skill Builder"
description: "Create new Claude Code Skills with proper YAML frontmatter, progressive disclosure structure, and complete directory organisation. Use when you need to build custom skills for specific workflows, generate skill templates, or understand the Claude Skills specification."
---

# Skill Builder

## When To Use

Use this skill when you need to:
- Create a new Claude Code Skill from scratch
- Understand the Claude Skills specification and structure
- Generate a skill directory layout and starter `SKILL.md`
- Audit an existing skill for spec compliance

**When NOT to use:**
- Using an existing skill — invoke it directly; this skill only creates new ones
- Validating existing docs — use the docs-alignment skill
- Scaffolding from a PRD — use the prd2build skill
- General code generation without skill packaging — write code directly

---

## Quick Start

```bash
# 1. Create skill directory at the correct location
mkdir -p ~/.claude/skills/my-skill        # personal (all projects)
# or
mkdir -p .claude/skills/my-skill          # project-scoped (version controlled)

# 2. Create SKILL.md with required frontmatter
cat > ~/.claude/skills/my-skill/SKILL.md << 'EOF'
---
name: "My Skill"
description: "What this skill does. Use when [trigger conditions]."
---

# My Skill

## When To Use
[Brief description]

## Quick Start
[Single most common usage]

## Step-by-Step Guide
[Core instructions]
EOF
```

---

## Required: YAML Frontmatter

Every `SKILL.md` must open with YAML frontmatter containing exactly two fields:

```yaml
---
name: "Skill Name"          # REQUIRED — max 64 chars, Title Case
description: "What it does and when to use it."  # REQUIRED — max 1024 chars
---
```

**`name`**: human-friendly display name, max 64 characters.

**`description`**: must answer both _what_ (functionality) and _when_ (trigger conditions). Front-load keywords — this text is loaded into Claude's system prompt for autonomous matching. Max 1024 characters.

```yaml
# Good — keywords first, explicit "when" clause
description: "Generate OpenAPI 3.0 docs from Express.js routes. Use when creating API docs, documenting endpoints, or building API specifications."

# Bad — no trigger conditions
description: "A comprehensive guide to API documentation."
```

No other frontmatter fields are recognised by the Claude runtime.

---

## Directory Layout

```
~/.claude/skills/my-skill/      # MUST sit directly here — no deeper nesting
    SKILL.md                    # REQUIRED entry point
    REFERENCE.md                # Optional: full spec and field details
    EXAMPLES.md                 # Optional: templates and worked examples
    eval-suite-template.md      # Optional: eval/validation stubs
    scripts/                    # Optional: executable scripts
    resources/                  # Optional: templates, schemas, examples
    docs/                       # Optional: ADVANCED.md, TROUBLESHOOTING.md
```

The skill directory must be placed **directly** under `~/.claude/skills/` or `.claude/skills/`. Subdirectories _within_ the skill are fully supported.

---

## Progressive Disclosure

Claude loads skill content in three levels:

| Level | Content | When loaded |
|-------|---------|-------------|
| 1 | `name` + `description` frontmatter | Always (all skills, minimal context) |
| 2 | `SKILL.md` body | Only when this skill is active |
| 3 | Linked sibling files (`REFERENCE.md`, `EXAMPLES.md`, etc.) | On demand as Claude navigates |

**Target sizes**: `SKILL.md` body 2–5 KB. Move lengthy spec details, all templates, and long examples into sibling files linked from here.

---

## Recommended SKILL.md Structure

```markdown
---
name: "..."
description: "..."
---

# Skill Name

## When To Use
[2-3 sentences. When yes, when no.]

## Prerequisites
[Only if non-obvious]

## Quick Start
[Single bash block covering the 80% case]

## Step-by-Step Guide
[Core instructions]

## Advanced / Reference
See [REFERENCE.md](REFERENCE.md) for full spec details.
See [EXAMPLES.md](EXAMPLES.md) for templates and worked examples.
```

---

## Validation Checklist

Before publishing a skill:

- [ ] `SKILL.md` starts with `---` YAML block
- [ ] `name` present, max 64 chars
- [ ] `description` present, max 1024 chars, answers _what_ and _when_
- [ ] Skill directory sits directly under `~/.claude/skills/` or `.claude/skills/`
- [ ] `SKILL.md` body 2–5 KB (move excess to sibling files)
- [ ] At least one concrete usage example included
- [ ] Skill appears in Claude's skill list after reload
- [ ] Description triggers on the intended query types

For eval/validation methodology, see [eval-suite-template.md](eval-suite-template.md).

---

## Diagram-Driven Diagnosis

> Complex multi-function bug or suspected parallel implementations in a skill under construction? Use this method.

Use when: a bug or design defect spans many functions or modules; you suspect duplicate or parallel implementations of the same concern (multiple writers, divergent validators, shadow copies of an algorithm); or symptom-chasing is not converging on root cause.

### Phase 1 — Cartography

Spawn N Sonnet agents, one per concern. Each agent renders its slice of the system as a renderable Mermaid sequence or flow diagram built **from the actual code, not from docs**. Concerns are domain-specific — for example: settings flow, data population and socket handoff, interaction events, update and backoff logic, data types, GPU physics, analysis/clustering.

Each agent maps **all** code paths into its diagram and explicitly flags any parallel or duplicate implementation it finds.

### Phase 2 — Queen Synthesis

One Opus coordinator collates the diagrams into a single ranked anomaly register (e.g. `00-anomaly-register.md`) containing:
- a Mermaid mindmap of anomaly themes
- a revert-vs-reconcile table for each duplication
- git archaeology identifying the commit that introduced each divergence

### Phase 3 — QE Fleet

Brief QE agents to write **failing repro tests** that depend only on the model/pure layer (no GPU, no network) to prove each anomaly objectively before any fix is attempted. This converts "I suspect X" into a red test.

### Phase 4 — Fix with Live Diagrams

Implement fixes (deleting or deprecating parallel paths where they are not integrated), updating each Mermaid diagram as you go so resolutions visibly click into place. The red repro tests flip green as proof.

**Why it works:** forcing every parallel implementation into one visible artefact makes divergent authorities obvious — for example, one layer reads `metadata.type` while another reads a top-level `type` field. Failing repro tests prevent symptom-chasing and premature hacks.

---

## Reference and Examples

- Full field spec, YAML rules, scripts/resources layout: [REFERENCE.md](REFERENCE.md)
- Starter templates (minimal, intermediate, advanced) and worked examples: [EXAMPLES.md](EXAMPLES.md)
- Eval-suite stub for validating generated skills: [eval-suite-template.md](eval-suite-template.md)
