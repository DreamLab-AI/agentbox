# Skill Builder — Field Specification and Falsification Evidence

Deep reference for `SKILL.md`. Read this when you need the full rules, not
just the summary.

---

## `name` — full rule

| Attribute | Value |
|-----------|-------|
| Type | String |
| Pattern | `/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/` -- lowercase unicode alphanumerics and hyphens only |
| Max length | 64 characters |
| Constraint | Must equal the parent directory name exactly |
| Usage | Shown in skill lists; loaded into the system prompt at metadata level |

Good examples: `api-doc-generator`, `react-component-builder`,
`database-schema-designer` -- directory `skills/api-doc-generator/` carries
`name: api-doc-generator`.

Bad examples:
- `"API Documentation Generator"` -- Title Case, spaces: invalid character
  class on both the agentskills.io spec and the vendored ruflo/Codex
  validator (`/^[a-z][a-z0-9-]*$/`, error message "must be lowercase with
  hyphens only").
- `skill-1` -- valid characters but not descriptive; passes the lint, fails
  good practice.
- A name exceeding 64 characters.

## `description` — full rule

| Attribute | Value |
|-----------|-------|
| Type | String |
| Max length | 1024 characters |
| Format | Plain text; minimal markdown acceptable |
| Usage | Loaded into the system prompt for autonomous skill matching |

Must answer:
1. **What** the skill does (functionality).
2. **When** to invoke it (trigger conditions), front-loaded.
3. **When not** to invoke it, once there is a plausible neighbour skill.

```yaml
# Good — keywords first, explicit "when" and "when not"
description: "Generate OpenAPI 3.0 docs from Express.js routes. Use when creating API docs, documenting endpoints, or building API specifications. Not for GraphQL schemas -- use the graphql-docs skill."

# Bad — no trigger conditions
description: "A comprehensive guide to API documentation."
```

### YAML formatting gotchas

```yaml
# Correct: simple string
name: api-builder
description: "Creates REST APIs with Express and TypeScript."

# Correct: block scalar for a long description
name: full-stack-generator
description: >-
  Generates full-stack applications with a React frontend and Node.js
  backend. Use when starting new projects or scaffolding applications.

# Correct: special characters quoted
name: json-api-builder
description: "Creates JSON:API compliant endpoints: pagination, filtering, relationships."

# Wrong: unquoted colon inside a plain scalar — YAML parse error
name: api:builder
```

---

## Falsified v1 claims (with sources, 2026-09-09)

The prior version of this skill taught four things that a live audit
independently falsified. Recorded here so a future editor does not
reintroduce them.

1. **"`name` is a Title Case display name."** Wrong per agentskills.io
   `/specification` (fetched live: "May only contain unicode lowercase
   alphanumeric characters (a-z, 0-9) and hyphens"; Title Case given as an
   explicit invalid example) and per the vendored ruflo/Codex validator
   (`.../@claude-flow/codex/dist/validators/index.js:216`, hard error on
   `/^[a-z][a-z0-9-]*$/` failure). This skill's own old frontmatter,
   `name: "Skill Builder"` against directory `skill-builder`, failed its
   own taught rule.
2. **"No other frontmatter fields are recognised by the Claude runtime;
   additional fields are silently ignored."** Wrong: the estate has 50+
   distinct frontmatter keys in live productive use across the corpus
   (`version`, `author`, `tags`, `mcp_server`, ...), and agentskills.io
   itself defines `license`, `compatibility`, `metadata`, `allowed-tools`
   as first-class optional fields.
3. **"Progressive disclosure means flat `REFERENCE.md`/`EXAMPLES.md`
   siblings at the skill root."** Wrong against this estate's own
   enforcement: `skills/lint-skills.mjs`'s BUDGET check (ADR-2021) only
   recognises a `references/` directory holding a readable file as
   satisfying progressive disclosure once `SKILL.md` exceeds 250 lines.
   Flat siblings do not satisfy it. Corroborating evidence: the lint used
   to carve this skill out of its absolute-path check specifically because
   its own examples cited a harness's personal skills directory by literal
   path -- the maintainers suppressed the symptom rather than fixing the
   content. This rewrite removes every such literal path, so the carve-out
   is no longer needed.
4. **"The skill directory MUST sit directly under a harness's own personal
   or project skills directory."** Wrong as a universal claim: this
   estate's single master copy is one directory below the skills root that
   bakes into the image; reaching a harness's own skills directory at all
   requires the boot-time reconciler and covers only the registered
   subset, not every skill in the tree.

---

## Directory structure — reference

### Minimal (required only)

```
skills/my-skill/
    SKILL.md
```

### Full-featured

```
skills/my-skill/
    SKILL.md
    references/
        field-spec.md
        templates.md
    scripts/
        setup.sh
        validate.js
    assets/
        templates/
            component.tsx.template
        schemas/
            config.schema.json
```

### `scripts/`

Holds executable helpers Claude can invoke. Reference them from `SKILL.md`:

```markdown
## Setup
\`\`\`bash
./scripts/setup.sh
\`\`\`
```

### `assets/`

Holds static files: templates, schemas, example outputs. Reference by
relative path:

```markdown
Copy the component template:
\`\`\`bash
cp assets/templates/component.tsx.template src/components/MyComponent.tsx
\`\`\`
```

### `references/`

Depth material only: full field specs, long worked examples, troubleshooting
trees. One level below `SKILL.md` -- Claude has been observed to `head -100`
rather than fully read a nested reference chain, so do not nest a second
`references/` inside a reference file's own directory.

---

## Progressive disclosure — three levels

| Level | Content | When loaded |
|-------|---------|--------------|
| 1 | `name` + `description` | Always, for every registered skill |
| 2 | `SKILL.md` body | Only when this skill is active |
| 3 | `references/`, `scripts/`, `assets/` | On demand as Claude navigates |

Target: `SKILL.md` body under 250 lines (this estate's hard lint cap) and
under 5,000 tokens (agentskills.io's own recommendation, which is the
tighter constraint for a dense file). Move anything only needed occasionally
into `references/`.

---

## Full validation checklist

**YAML frontmatter:**
- [ ] Starts with `---`, ends with `---`
- [ ] `name` lowercase-hyphen, matches directory, <=64 chars
- [ ] `description` <=1024 chars, states what+when(+when-not)
- [ ] No YAML syntax errors
- [ ] Every non-portable-core, non-Claude-extra key checked against
      SKILL-DIRECTORY.md's existing vocabulary before being added

**File structure:**
- [ ] `SKILL.md` exists at `skills/<name>/SKILL.md` (the master copy, not a
      harness's own skills directory)
- [ ] Depth lives in `references/`, executables in `scripts/`, data in
      `assets/` -- no flat `REFERENCE.md`/`EXAMPLES.md` at the root

**Content quality:**
- [ ] Quick Start / scaffold shows the common case
- [ ] Long reference material moved to `references/` with working links
- [ ] At least one concrete example

**Progressive disclosure:**
- [ ] `SKILL.md` body <=250 lines, or `references/` holds a readable file
- [ ] Navigation links between levels present and resolve

**Registration and discovery:**
- [ ] If this skill should be always-loaded, ask the queen/router owner to
      add it to `registered-skills.txt`
- [ ] Ask for a SKILL-DIRECTORY.md entry and a routing-table.md row
      regardless -- without both it is reachable only by direct invocation

**Testing:**
- [ ] `bash skills/lint-skills.sh` exits 0
- [ ] Description triggers on the intended query types (see Evals in
      `SKILL.md`)
- [ ] Scripts execute successfully, if included
