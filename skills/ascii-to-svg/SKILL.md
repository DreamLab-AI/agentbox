---
name: ascii-to-svg
description: "Convert ASCII art diagrams in markdown files to clean, designed SVGs with accessible text fallbacks. Tracks changes via a hashed manifest and regenerates stale SVGs. Use when a README or docs have ASCII diagrams that need SVG conversion, or when asked to sync/regenerate diagram SVGs."
license: MIT
version: 2.2.0
author: ISO Vision LLC
allowed-tools: Bash(xmllint *)
tags:
  - documentation
  - diagrams
  - svg
  - ascii
  - readme
  - on-demand
---

Requires: `xmllint` for SVG validation (the skill still runs without it, skipping validation). No API keys. Optional: Playwright (visual verification), `jq` (auto-sync hook). See `REQUIREMENTS.md`.

# ASCII Art to SVG Conversion Skill

## Purpose
Convert ASCII art diagrams in markdown files to clean, designed SVGs
with accessible text fallbacks, kept in sync with their ASCII source.

## Requirements (no API keys)
This skill calls no external service and needs **no API keys**. It needs only
`xmllint` for SVG validation (the skill still runs without it, skipping
validation). Playwright is optional, for visual verification. Full details in
`REQUIREMENTS.md`. Default output uses the polished visual style defined in
`conversion-rules.md`.

## When to Use

### Initial Conversion
User requests to convert ASCII art/diagrams to SVG in:
- A specific file ("Convert ASCII art in README.md")
- A directory ("Convert diagrams in docs/")
- Entire repo ("Convert all ASCII art in this project")
- Changed files ("Convert ASCII art in files changed since main")

### Automatic Change Detection (v2.1+, opt-in)
An **optional** PostToolUse hook (`hooks/ascii-svg-auto-sync.sh`, baked at
`/opt/agentbox/skills/ascii-to-svg/hooks/`) reports stale diagrams after a
markdown edit. It is **not installed by default** in agentbox — wire it into a
profile's `settings.json` `PostToolUse` block (see `SHARING.md`), referencing it
portably via `${CLAUDE_SKILL_DIR}/hooks/ascii-svg-auto-sync.sh`. Behaviour:
- Fires after an Edit/Write; no-ops unless a `.ascii-to-svg-manifest.json` exists in the project root
- Compares ASCII hashes (requires `jq`) and reports any diagram that has gone stale
- It only **reports** — Claude regenerates the SVG when it sees the message

When the hook is not installed, use the manual commands below.

### Manual Commands (Optional)
These commands are available but rarely needed due to automatic detection:
- "Sync ASCII to SVG" — Force check all tracked diagrams
- "Show ASCII to SVG status" — Display tracking manifest summary
- "Initialize ASCII tracking" — Create manifest from existing diagrams
- "Regenerate all SVGs" — Force regenerate everything

## Process Overview

### Initial Conversion
1. **Scan** target file(s) for ASCII art (see detection.md)
2. **Report** findings and get confirmation for ambiguous cases
3. **Convert** each diagram to SVG (see conversion-rules.md)
4. **Save** SVG to asset directory
5. **Update** markdown with image reference + details fallback
6. **Validate** with xmllint
7. **Add to manifest** (see change-tracking.md) ← NEW
8. **Verify** with Playwright if requested (see playwright-verification.md)
9. **Report** summary

### Sync Process (Change Detection)
1. **Read** `.ascii-to-svg-manifest.json` from project root
2. **Extract** ASCII content from each tracked `<details>` block
3. **Hash** current ASCII content (SHA-256, normalized)
4. **Compare** to stored hash in manifest
5. **Regenerate** any SVGs where ASCII hash changed
6. **Update** manifest with new hashes
7. **Report** sync summary (up-to-date, stale, missing, untracked)

## Default Configuration

| Setting | Default | Override |
|---------|---------|----------|
| Asset directory | `assets/diagrams/` | User specifies path |
| SVG style | Minimal/conservative | `"using [style] style"` |
| Playwright verify | No | `"verify with Playwright"` |

## Invocation Examples

```
"Convert ASCII art in README.md"
"Convert all ASCII diagrams in docs/ using blueprint style"
"Convert ASCII art in this repo and verify with Playwright"
"Show me what ASCII art you'd convert in this project" (dry-run)
"Convert ASCII art in files changed since main"
```

## Output Format (MANDATORY)

Every converted diagram MUST follow this exact pattern:

```markdown
![Diagram description](assets/diagrams/filename.svg)

<details>
<summary>ASCII Version (for AI/accessibility)</summary>

\`\`\`
[original ASCII art here]
\`\`\`

</details>
```

No variations. The `<details>` block MUST immediately follow the image.

## SVG Requirements (MANDATORY)

Every generated SVG MUST have all four attributes on root element:

```xml
<svg xmlns="http://www.w3.org/2000/svg" 
     viewBox="0 0 WIDTH HEIGHT"
     width="WIDTH" 
     height="HEIGHT">
```

### XML Entity Escaping (CRITICAL)

| Character | Escape As |
|-----------|-----------|
| & | `&amp;` |
| < | `&lt;` |
| > | `&gt;` |
| " | `&quot;` (in attributes) |

### Validation

Always run before completing:
```bash
xmllint --noout path/to/file.svg
```

## Confidence Threshold

| Confidence | Action |
|------------|--------|
| ≥75% | Auto-convert |
| 40-74% | Show to user, ask for confirmation |
| <40% | Skip, note in report |

## Dry-Run Mode

If user says "show me" or "what would you convert" or "preview":
- Scan and detect ASCII art
- Report findings with confidence scores
- Show preview of detected diagrams
- Do NOT convert or modify anything

## File Naming

SVG files named based on:
1. Preceding header if exists: `## Architecture` → `architecture.svg`
2. Preceding description if exists: "The auth flow:" → `auth-flow.svg`
3. Fallback: `{markdown-filename}-diagram-{n}.svg`

## Directory Creation

If `assets/diagrams/` (or user-specified path) doesn't exist, create it.

## Dependencies

**Required:**
- xmllint (for SVG validation)

**Optional:**
- Playwright (for visual verification)

## Error Handling

- If xmllint not found: warn, skip validation, continue
- If Playwright not found but requested: warn, skip verification, continue
- If SVG fails validation: fix and retry (max 3 attempts)
- If asset directory doesn't exist: create it

## Skip Markers

Users can mark blocks to skip conversion:

```markdown
<!-- skip-ascii-to-svg -->
\`\`\`
[ASCII art that should not be converted]
\`\`\`
```

Or force conversion with type hint:

```markdown
<!-- convert-to-svg: flowchart -->
\`\`\`
[ASCII that might have low confidence]
\`\`\`
```

## Summary Report

After processing, always provide:

```markdown
## ASCII to SVG Conversion Complete

### Files Processed
| File | Diagrams | Converted | Skipped |
|------|----------|-----------|---------|
| README.md | 2 | 2 | 0 |

### Generated Assets
- `assets/diagrams/filename.svg`

### Skipped (Low Confidence)
- `file.md` line N: reason

### Validation
- All SVGs passed xmllint validation ✓
- Playwright verification: [Passed/Skipped/N/A]
```

## Manifest File (MANDATORY for tracking)

When converting diagrams, ALWAYS create/update `.ascii-to-svg-manifest.json`:

```json
{
  "version": "1.0.0",
  "lastSync": "2026-01-08T09:50:00Z",
  "diagrams": [
    {
      "id": "diagram-name",
      "sourceFile": "docs/README.md",
      "sourceLine": 45,
      "svgFile": "docs/assets/diagrams/diagram-name.svg",
      "asciiHash": "sha256:...",
      "lastConverted": "2026-01-08T09:30:00Z"
    }
  ]
}
```

See `change-tracking.md` for full specification.

## Reference Documents

- `detection.md` - How to identify ASCII art
- `conversion-rules.md` - SVG generation specifications
- `change-tracking.md` - Change detection and sync (NEW)
- `playwright-verification.md` - Visual verification process
- `examples/` - ASCII→SVG conversion examples
