# Skill Builder — Reference

Full specification details. Keep this file for deep reference; `SKILL.md` is the entry point.

---

## YAML Frontmatter — Field Specification

### `name` (REQUIRED)

| Attribute | Value |
|-----------|-------|
| Type | String |
| Max length | 64 characters |
| Format | Human-friendly display name, Title Case |
| Usage | Shown in skill lists and loaded into Claude's system prompt |

Good examples:
- "API Documentation Generator"
- "React Component Builder"
- "Database Schema Designer"

Bad examples:
- "skill-1" — not descriptive
- "This is a very long skill name that exceeds sixty-four characters" — too long

### `description` (REQUIRED)

| Attribute | Value |
|-----------|-------|
| Type | String |
| Max length | 1024 characters |
| Format | Plain text; minimal markdown acceptable |
| Usage | Loaded into Claude's system prompt for autonomous skill matching |

The description must answer:
1. **What** the skill does (functionality)
2. **When** Claude should invoke it (trigger conditions)

Front-load keywords — they are used for matching before the body is loaded.

Good examples:
```yaml
description: "Generate OpenAPI 3.0 documentation from Express.js routes. Use when creating API docs, documenting endpoints, or building API specifications."

description: "Create React functional components with TypeScript, hooks, and tests. Use when scaffolding new components or converting class components."
```

Bad examples:
```yaml
description: "A comprehensive guide to API documentation"  # no "when" clause
description: "Documentation tool"                           # too vague
```

### YAML Formatting Rules

```yaml
# Correct: simple string
name: "API Builder"
description: "Creates REST APIs with Express and TypeScript."

# Correct: multi-line description
name: "Full-Stack Generator"
description: "Generates full-stack applications with React frontend and Node.js backend.
  Use when starting new projects or scaffolding applications."

# Correct: special characters quoted
name: "JSON:API Builder"
description: "Creates JSON:API compliant endpoints: pagination, filtering, relationships."

# Wrong: missing quotes with special chars — YAML parse error
name: API:Builder

# Wrong: extra fields — ignored by the runtime, discouraged
name: "My Skill"
description: "My description"
version: "1.0.0"    # not part of spec
author: "Me"        # not part of spec
tags: ["dev"]       # not part of spec
```

Only `name` and `description` are used by the Claude runtime. Additional fields are silently ignored.

---

## Directory Structure

### Minimal (required only)

```
~/.claude/skills/my-skill/
    SKILL.md
```

### Full-featured (recommended)

```
~/.claude/skills/my-skill/
    SKILL.md                    # Entry point (required)
    REFERENCE.md                # Full spec details
    EXAMPLES.md                 # Templates and worked examples
    eval-suite-template.md      # Eval/validation stubs
    scripts/
        setup.sh
        validate.js
        generate.py
    resources/
        templates/
            component.tsx.template
            test.spec.ts.template
        examples/
            basic-example/
            advanced-example/
        schemas/
            config.schema.json
    docs/
        ADVANCED.md
        TROUBLESHOOTING.md
        API_REFERENCE.md
```

### Skill Locations

**Personal skills** — available across all projects for this user:
```
~/.claude/skills/[skill-name]/
```
Not committed to git. Use for personal productivity tools.

**Project skills** — team-shared, version controlled:
```
<project-root>/.claude/skills/[skill-name]/
```
Should be committed to git. Use for team workflows and project-specific tooling.

**Constraint**: The skill directory must sit **directly** under `~/.claude/skills/` or `.claude/skills/`. Claude Code does not traverse deeper nesting for skill discovery. Subdirectories *inside* the skill directory are fully supported.

---

## Progressive Disclosure — Detailed Explanation

Claude loads skill content in three levels to scale to 100+ installed skills with minimal context overhead.

### Level 1: Metadata (~200 chars per skill)
Loaded at Claude Code startup for every installed skill. Contains only `name` and `description`. With 100 skills this is roughly 6 KB of context — negligible.

### Level 2: SKILL.md body (1–10 KB)
Loaded only when the skill is triggered or matched. Contains main instructions and common procedures. Should cover the 80% case without the reader needing to navigate further.

### Level 3+: Linked sibling files (variable)
Loaded on demand as Claude navigates to referenced files. Contains deep reference material, full templates, troubleshooting trees, and large examples.

**Target**: Keep `SKILL.md` body under 5 KB. Move anything you'd only need occasionally into a sibling file with a clear link from `SKILL.md`.

---

## Scripts and Resources

### `scripts/` directory

Holds executable scripts that Claude can invoke. Reference them from `SKILL.md`:

```markdown
## Setup
```bash
./scripts/setup.sh
```

## Validate
```bash
node scripts/validate.js config.json
```
```

### `resources/` directory

Holds static files: templates, schemas, example outputs. Reference by relative path:

```markdown
## Templates
Copy the component template:
```bash
cp resources/templates/component.tsx.template src/components/MyComponent.tsx
```

## Examples
Working examples in `resources/examples/`:
- `basic-example/` — simple component
- `advanced-example/` — with hooks and context
```

---

## File References and Navigation

Claude can follow relative paths and Markdown links to load referenced files.

```markdown
# Markdown link
See [Advanced Configuration](docs/ADVANCED.md) for complex scenarios.

# Inline path reference
Use the template at `resources/templates/api-template.js`

# Directory reference
See examples in `resources/examples/basic-usage/`
```

Best practice: keep `SKILL.md` lean (~2–5 KB). Move lengthy content to sibling files. Claude loads only what it navigates to.

---

## Full Validation Checklist

**YAML Frontmatter**:
- [ ] Starts with `---`
- [ ] `name` present, ≤ 64 chars
- [ ] `description` present, ≤ 1024 chars
- [ ] Description includes "what" and "when"
- [ ] Ends with `---`
- [ ] No YAML syntax errors

**File Structure**:
- [ ] `SKILL.md` exists in skill directory
- [ ] Directory sits directly under `~/.claude/skills/` or `.claude/skills/`
- [ ] Directory name is clear and descriptive

**Content Quality**:
- [ ] Overview is brief and clear
- [ ] Quick Start shows the most common use case
- [ ] Step-by-step guide covers main workflow
- [ ] Long reference material moved to sibling files with links
- [ ] Examples are concrete and runnable

**Progressive Disclosure**:
- [ ] `SKILL.md` body ≤ 5 KB
- [ ] Advanced content in `REFERENCE.md` or `docs/`
- [ ] Large resources in `resources/`
- [ ] Navigation links between levels present

**Testing**:
- [ ] Skill appears in Claude's skill list after install
- [ ] Description triggers on relevant queries
- [ ] Instructions are clear and actionable
- [ ] Scripts execute successfully (if included)
- [ ] Examples work as documented

For structured eval methodology, see [eval-suite-template.md](eval-suite-template.md).
