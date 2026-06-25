# ASCII to SVG Change Tracking

Updated: 2026-01-08 10:30:00 EST | Version 2.0.0
Created: 2026-01-08 09:50:00 EST

## Purpose

Track ASCII diagrams and their corresponding SVGs to automatically detect
when source ASCII changes and regenerate outdated SVGs.

## Automatic Detection (Global Hook)

**The system now automatically detects stale SVGs** via the global PostToolUse hook:
- Location: `~/.claude/hooks/ascii-svg-auto-sync.sh`
- Trigger: After any Edit/Write to `.md` files
- Action: Compares ASCII hashes and outputs regeneration instructions

When you edit a markdown file with tracked diagrams, the hook will:
1. Find the project manifest (`.ascii-to-svg-manifest.json`)
2. Extract ASCII content from `<details>` blocks
3. Compare against stored hashes
4. Output regeneration instructions if stale

**This is set-and-forget** — you don't need to remember to run sync commands.

## Manifest File

Every project using ASCII-to-SVG should have a manifest file at:
```
.ascii-to-svg-manifest.json
```

### Manifest Schema

```json
{
  "version": "1.0.0",
  "lastSync": "2026-01-08T09:50:00Z",
  "diagrams": [
    {
      "id": "medreview-platform",
      "sourceFile": "docs/01-ARCHITECTURE.md",
      "sourceLine": 45,
      "svgFile": "docs/assets/diagrams/medreview-platform.svg",
      "asciiHash": "sha256:a1b2c3d4...",
      "svgHash": "sha256:e5f6g7h8...",
      "lastConverted": "2026-01-08T09:30:00Z",
      "diagramType": "architecture"
    }
  ]
}
```

### Field Definitions

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (derived from SVG filename) |
| `sourceFile` | string | Path to markdown file containing ASCII |
| `sourceLine` | number | Line number where `<details>` block starts |
| `svgFile` | string | Path to generated SVG |
| `asciiHash` | string | SHA-256 hash of ASCII content (normalized) |
| `svgHash` | string | SHA-256 hash of SVG file |
| `lastConverted` | ISO8601 | When SVG was last generated |
| `diagramType` | string | Classification (flowchart, architecture, etc.) |

## Hash Calculation

### ASCII Content Normalization

Before hashing, normalize ASCII content:
1. Trim leading/trailing whitespace from each line
2. Remove empty lines at start/end
3. Normalize line endings to `\n`
4. Remove any markdown code fence markers

```javascript
function normalizeAscii(content) {
  return content
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .trim();
}
```

### Hash Algorithm

Use SHA-256 for content hashing:
```bash
echo -n "$normalized_content" | shasum -a 256 | cut -d' ' -f1
```

## Sync Commands

### Full Sync
```
"Sync ASCII to SVG in this project"
"Check for stale SVGs"
```

Process:
1. Read `.ascii-to-svg-manifest.json`
2. For each entry, extract current ASCII from markdown
3. Compare hash to stored `asciiHash`
4. If different: regenerate SVG, update manifest
5. Report changes

### Watch Mode (Manual Trigger)
```
"Watch for ASCII changes"
```

Process:
1. Scan all markdown files for `<details>` blocks with ASCII
2. Compare against manifest
3. Report any mismatches
4. Offer to regenerate stale SVGs

### Force Regenerate
```
"Regenerate all SVGs"
"Force regenerate SVGs in docs/"
```

Regenerates all tracked SVGs regardless of hash match.

## Detection of Tracked Diagrams

A diagram is considered "tracked" if it follows the output format:

```markdown
![Description](path/to/diagram.svg)

<details>
<summary>ASCII Version (for AI/accessibility)</summary>

```
[ASCII content here - THIS IS THE SOURCE OF TRUTH]
```

</details>
```

The ASCII inside `<details>` is authoritative. If it changes, the SVG is stale.

## Sync Report

After sync operation, report:

```markdown
## ASCII to SVG Sync Report

### Checked
- 7 diagrams in manifest

### Up to Date
- `medreview-platform.svg` ✓
- `analysis-pipeline.svg` ✓

### Stale (Regenerated)
- `security-architecture.svg` - ASCII changed, regenerated

### Missing
- `removed-diagram.svg` - Source ASCII not found (removed from manifest)

### Untracked
- `docs/NEW-DOC.md` line 45 - New ASCII diagram detected, not in manifest
  → Run "Convert ASCII art in docs/NEW-DOC.md" to track
```

## Manifest Maintenance

### Adding New Diagrams

When converting ASCII to SVG, ALWAYS add to manifest:
1. Generate unique ID from SVG filename
2. Calculate ASCII hash
3. Calculate SVG hash
4. Add entry to manifest
5. Save manifest

### Removing Diagrams

When ASCII is deleted from markdown:
1. Sync detects missing source
2. Report as "Missing"
3. Optionally remove from manifest (ask user)
4. Optionally delete orphaned SVG (ask user)

### Manifest Location

The manifest file should be:
- In project root: `.ascii-to-svg-manifest.json`
- Committed to git (tracks diagram history)
- Not in `.gitignore`

## Integration with Git

### Pre-commit Hook (Optional)

```bash
#!/bin/bash
# .git/hooks/pre-commit

# Check for stale SVGs
claude "Check for stale ASCII to SVG diagrams" --quiet

if [ $? -ne 0 ]; then
  echo "Warning: Some SVGs may be stale. Run 'Sync ASCII to SVG' to update."
fi
```

### Changed Files Mode

```
"Sync ASCII to SVG in files changed since main"
```

Only checks/updates diagrams in files that have git changes.

## Error States

### Manifest Missing
If no manifest exists but SVG + details blocks found:
- Offer to create manifest from existing diagrams
- Calculate hashes for all found pairs

### Hash Mismatch
If ASCII hash doesn't match stored value:
- ASCII was edited → Regenerate SVG
- Update manifest with new hash

### SVG Missing
If SVG file referenced in manifest doesn't exist:
- Regenerate from ASCII source
- Update manifest

### ASCII Missing
If `<details>` block was removed from markdown:
- Report as orphaned
- Ask user: keep SVG? remove from manifest?

## Best Practices

1. **Always commit manifest** - It's the source of truth for tracking
2. **Run sync before major releases** - Ensure all SVGs are current
3. **Use git diff to review ASCII changes** - The `<details>` block is diffable
4. **Don't edit SVGs directly** - Edit ASCII, then sync

## Commands Summary

| Command | Action |
|---------|--------|
| `Sync ASCII to SVG` | Check all, regenerate stale |
| `Check for stale SVGs` | Report only, no changes |
| `Regenerate all SVGs` | Force regenerate everything |
| `Initialize ASCII tracking` | Create manifest from existing |
| `Show ASCII to SVG status` | Display manifest summary |
