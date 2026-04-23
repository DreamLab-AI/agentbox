# Skill Builder — Templates and Examples

Starter templates for new skills. Copy the appropriate template to `~/.claude/skills/my-skill/SKILL.md` and customise.

---

## Template 1: Minimal Skill

For simple, self-contained skills with no scripts or external resources.

```markdown
---
name: "My Basic Skill"
description: "One sentence what. One sentence when to use."
---

# My Basic Skill

## When To Use
[2–3 sentences describing when this skill applies. Include an explicit "when not" if helpful.]

## Quick Start
```bash
# Single command to get started
```

## Step-by-Step Guide

### Step 1: Setup
[Instructions]

### Step 2: Usage
[Instructions]

### Step 3: Verify
[How to confirm success]

## Troubleshooting
- **Issue**: Problem description — **Solution**: Fix description
```

---

## Template 2: Intermediate Skill (with scripts)

For skills that ship executable helpers or structured resources.

```markdown
---
name: "My Intermediate Skill"
description: "Detailed what with key features. Use when [trigger 1], [trigger 2], or [trigger 3]."
---

# My Intermediate Skill

## When To Use
[Clear trigger conditions. When not to use.]

## Prerequisites
- Requirement 1 (version X+)
- Requirement 2

## Quick Start
```bash
./scripts/setup.sh
./scripts/generate.sh my-project
```

## Configuration
Edit `config.json`:
```json
{
  "option1": "value1",
  "option2": "value2"
}
```

## Step-by-Step Guide

### Basic Usage
[Steps for the 80% case]

### Advanced Usage
[Steps for complex scenarios]

## Available Scripts
- `scripts/setup.sh` — initial setup
- `scripts/generate.sh` — code generation
- `scripts/validate.sh` — validation

## Resources
- Templates: `resources/templates/`
- Examples: `resources/examples/`

## Troubleshooting
[Common issues and solutions]
```

---

## Template 3: Full-Featured Skill

For skills with multi-file structure, CI/CD hooks, and deep reference material.

```markdown
---
name: "My Advanced Skill"
description: "Comprehensive what with all features. Use when [trigger 1], [trigger 2], or [trigger 3]. Supports [technology stack]."
---

# My Advanced Skill

## When To Use
[Explicit triggers. Explicit exclusions.]

## Prerequisites
- Technology 1 (version X+)
- Technology 2 (version Y+)
- API keys or credentials

## What This Skill Does
1. **Core Feature**: Description
2. **Integration**: Description
3. **Automation**: Description

---

## Quick Start

```bash
./scripts/install.sh
./scripts/quickstart.sh
```

---

## Step-by-Step Guide

### 1. Initial Setup
[Detailed steps]

### 2. Core Workflow
[Main procedures]

### 3. Integration
[Integration steps]

---

## Advanced Features
See [ADVANCED.md](docs/ADVANCED.md) for complex scenarios.

## Scripts Reference

| Script | Purpose | Usage |
|--------|---------|-------|
| `install.sh` | Install dependencies | `./scripts/install.sh` |
| `generate.sh` | Generate code | `./scripts/generate.sh [name]` |
| `validate.sh` | Validate output | `./scripts/validate.sh` |

## Resources
- `resources/templates/basic.template` — basic template
- `resources/examples/basic/` — simple worked example
- `resources/schemas/config.schema.json` — configuration schema

## Troubleshooting
See [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) for known issues.

## API Reference
See [API_REFERENCE.md](docs/API_REFERENCE.md).
```

---

## Worked Example 1: README Generator

```markdown
---
name: "README Generator"
description: "Generate comprehensive README.md files for GitHub repositories. Use when starting new projects, documenting existing code, or improving incomplete READMEs."
---

# README Generator

## When To Use
Use when a project is missing a README or when the existing README lacks installation, usage, or contribution sections. Not for generating documentation sites or API references — use the API docs skill for those.

## Quick Start
```bash
./scripts/generate-readme.sh
```
Produces `README.md` with project title, badges, installation, usage, and contribution sections.

## Customisation
Edit section templates in `resources/templates/sections/` before running.
```

---

## Worked Example 2: React Component Generator

```markdown
---
name: "React Component Generator"
description: "Generate React functional components with TypeScript, hooks, tests, and Storybook stories. Use when creating new components, scaffolding UI, or following component architecture patterns."
---

# React Component Generator

## When To Use
Use when adding new UI components to a React + TypeScript project. Not for migrating class components (use the migration skill) or generating pages (use the page generator skill).

## Prerequisites
- Node.js 18+
- React 18+
- TypeScript 5+

## Quick Start
```bash
./scripts/generate-component.sh MyComponent
```

Creates:
- `src/components/MyComponent/MyComponent.tsx`
- `src/components/MyComponent/MyComponent.test.tsx`
- `src/components/MyComponent/MyComponent.stories.tsx`
- `src/components/MyComponent/index.ts`

## Templates
See `resources/templates/` for available component templates:
- `basic.template` — simple functional component
- `with-state.template` — useState hooks
- `with-context.template` — useContext integration
- `with-api.template` — data fetching component
```
