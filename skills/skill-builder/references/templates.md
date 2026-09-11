# Skill Builder — Templates and Worked Examples

Starter templates for new skills. Copy the appropriate template to
`skills/my-skill/SKILL.md` and customise. All `name` values below are
lowercase-hyphen and match their directory, per this skill's contract.

---

## Template 1: Minimal Skill

For simple, self-contained skills with no scripts or external resources.

```markdown
---
name: my-basic-skill
description: "One sentence what. One sentence when to use. One clause on when not to."
---

# My Basic Skill

## When to use
[2-3 sentences describing when this skill applies. Include an explicit "when not" if helpful.]

## Quick Start
\`\`\`bash
# Single command to get started
\`\`\`

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

For skills that ship executable helpers or structured assets.

```markdown
---
name: my-intermediate-skill
description: "Detailed what with key features. Use when [trigger 1], [trigger 2], or [trigger 3]."
---

# My Intermediate Skill

## When to use
[Clear trigger conditions. When not to use.]

## Prerequisites
- Requirement 1 (version X+)
- Requirement 2

## Quick Start
\`\`\`bash
./scripts/setup.sh
./scripts/generate.sh my-project
\`\`\`

## Configuration
Edit \`config.json\`:
\`\`\`json
{
  "option1": "value1",
  "option2": "value2"
}
\`\`\`

## Step-by-Step Guide

### Basic Usage
[Steps for the common case]

### Advanced Usage
[Steps for complex scenarios]

## Available Scripts
- \`scripts/setup.sh\` — initial setup
- \`scripts/generate.sh\` — code generation
- \`scripts/validate.sh\` — validation

## Assets
- Templates: \`assets/templates/\`
- Examples: \`assets/examples/\`

## Troubleshooting
[Common issues and solutions]
```

---

## Template 3: Full-Featured Skill

For skills with multi-file structure and deep reference material.

```markdown
---
name: my-advanced-skill
description: "What it does, with key features. Use when [trigger 1], [trigger 2], or [trigger 3]. Supports [technology stack]. Not for [adjacent case] -- use [other-skill]."
compatibility: "Claude Code only -- uses hooks and the Artifact tool. On Codex: run phases sequentially in one session and report file paths."
---

# My Advanced Skill

## When to use
[Explicit triggers. Explicit exclusions.]

## Prerequisites
- Technology 1 (version X+)
- Technology 2 (version Y+)
- API keys or credentials, if any

## What This Skill Does
1. **Core Feature**: Description
2. **Integration**: Description
3. **Automation**: Description

## Quick Start

\`\`\`bash
./scripts/install.sh
./scripts/quickstart.sh
\`\`\`

## Step-by-Step Guide

### 1. Initial Setup
[Detailed steps]

### 2. Core Workflow
[Main procedures]

### 3. Integration
[Integration steps]

## Advanced Features
See [references/advanced.md](references/advanced.md) for complex scenarios.

## Scripts Reference

| Script | Purpose | Usage |
|--------|---------|-------|
| \`install.sh\` | Install dependencies | \`./scripts/install.sh\` |
| \`generate.sh\` | Generate code | \`./scripts/generate.sh [name]\` |
| \`validate.sh\` | Validate output | \`./scripts/validate.sh\` |

## Assets
- \`assets/templates/basic.template\` — basic template
- \`assets/examples/basic/\` — simple worked example
- \`assets/schemas/config.schema.json\` — configuration schema

## Troubleshooting
See [references/troubleshooting.md](references/troubleshooting.md) for known issues.

## API Reference
See [references/api.md](references/api.md).
```

---

## Worked Example 1: README Generator

```markdown
---
name: readme-generator
description: "Generate README.md files for GitHub repositories. Use when starting new projects, documenting existing code, or improving incomplete READMEs. Not for generating documentation sites or API references -- use the docs-alignment skill for those."
---

# README Generator

## When to use
Use when a project is missing a README or the existing one lacks
installation, usage, or contribution sections.

## Quick Start
\`\`\`bash
./scripts/generate-readme.sh
\`\`\`
Produces \`README.md\` with project title, badges, installation, usage, and
contribution sections.

## Customisation
Edit section templates in \`assets/templates/sections/\` before running.
```

---

## Worked Example 2: React Component Generator

```markdown
---
name: react-component-generator
description: "Generate React functional components with TypeScript, hooks, tests, and Storybook stories. Use when creating new components, scaffolding UI, or following component architecture patterns. Not for migrating class components or generating pages."
---

# React Component Generator

## When to use
Use when adding new UI components to a React + TypeScript project. Not for
migrating class components or generating pages -- use dedicated skills for
those if the estate has them.

## Prerequisites
- Node.js 18+
- React 18+
- TypeScript 5+

## Quick Start
\`\`\`bash
./scripts/generate-component.sh MyComponent
\`\`\`

Creates:
- \`src/components/MyComponent/MyComponent.tsx\`
- \`src/components/MyComponent/MyComponent.test.tsx\`
- \`src/components/MyComponent/MyComponent.stories.tsx\`
- \`src/components/MyComponent/index.ts\`

## Templates
See \`assets/templates/\` for available component templates:
- \`basic.template\` — simple functional component
- \`with-state.template\` — useState hooks
- \`with-context.template\` — useContext integration
- \`with-api.template\` — data-fetching component
```
