# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Antigravity Kit is an AI-powered design intelligence toolkit providing searchable databases of UI styles, color palettes, font pairings, chart types, and UX guidelines. It works as a skill/workflow for AI coding assistants (Claude Code, Windsurf, Cursor, etc.).

## Search Command

```bash
uiux-search "<query>" --domain <domain> [-n <max_results>]
```

**Domain search:**
- `product` - Product type recommendations (SaaS, e-commerce, portfolio)
- `style` - UI styles (glassmorphism, minimalism, brutalism)
- `typography` - Font pairings with Google Fonts imports
- `color` - Color palettes by product type
- `landing` - Page structure and CTA strategies
- `chart` - Chart types and library recommendations
- `ux` - Best practices and anti-patterns
- `prompt` - AI prompts and CSS keywords

**Stack search:**
```bash
uiux-search "<query>" --stack <stack>
```
Available stacks: `html-tailwind` (default), `react`, `nextjs`, `vue`, `svelte`, `swiftui`, `react-native`, `flutter`, `shadcn`, `jetpack-compose`

## Architecture

```
src/ui-ux-pro-max/                # Source of Truth
├── data/                         # Canonical CSV databases
│   ├── products.csv, styles.csv, colors.csv, typography.csv, ...
│   └── stacks/                   # Stack-specific guidelines
└── templates/
    ├── base/                     # Base templates (skill-content.md, quick-reference.md)
    └── platforms/                # Platform configs (claude.json, cursor.json, ...)

# The search engine itself is no longer Python: `uiux-search` is a compiled Rust
# binary (services/skill-tools in the agentbox repo, `uiux` module) that embeds
# these CSVs at compile time via `include_str!` — it is a BM25 + design-system-
# generation port of the former scripts/{core,search,design_system}.py, byte-for-
# byte verified against the original Python output. There is no scripts/ directory
# under src/ui-ux-pro-max/ any more.

cli/                              # CLI installer (uipro-cli on npm)
├── src/
│   ├── commands/init.ts          # Install command with template generation
│   └── utils/template.ts         # Template rendering engine
└── assets/                       # Bundled assets
    ├── data/                     # Copy of src/ui-ux-pro-max/data/
    └── templates/                # Copy of src/ui-ux-pro-max/templates/

.claude/skills/ui-ux-pro-max/     # Claude Code skill (symlinks to src/)
.shared/ui-ux-pro-max/            # Symlink to src/ui-ux-pro-max/
.cursor/, .windsurf/, .agent/, .github/, .kiro/, .opencode/, .roo/
                                  # Reference-only folders (use .shared/ for data)
```

The search engine uses BM25 ranking combined with regex matching. Domain auto-detection is available when `--domain` is omitted.

## Sync Rules

**Source of Truth:** `src/ui-ux-pro-max/`

When modifying files:

1. **Data & Scripts** - Edit in `src/ui-ux-pro-max/`:
   - `data/*.csv` and `data/stacks/*.csv`
   - `scripts/*.py`
   - Changes automatically available via symlinks in `.claude/`, `.shared/`

2. **Templates** - Edit in `src/ui-ux-pro-max/templates/`:
   - `base/skill-content.md` - Common SKILL.md content
   - `base/quick-reference.md` - Quick reference section (Claude only)
   - `platforms/*.json` - Platform-specific configs

3. **CLI Assets** - Run sync before publishing:
   ```bash
   cp -r src/ui-ux-pro-max/data/* cli/assets/data/
   cp -r src/ui-ux-pro-max/templates/* cli/assets/templates/
   ```
   `src/ui-ux-pro-max/scripts/` no longer exists — the search engine is now the
   `uiux-search` Rust binary, not a Python script the CLI installer copies into a
   user's project. **Unresolved follow-up:** `cli/assets/scripts/` and the
   `scriptPath` field in `src/ui-ux-pro-max/templates/platforms/*.json` still assume
   the old Python-script install model (the installer literally copies whatever is
   at `scriptPath` into the user's project — see `cli/src/utils/extract.ts`'s
   `copyFolders`), so `cli/` needs a companion change to ship the compiled
   `uiux-search` binary (per target platform/OS) instead before those can be
   repointed safely.

4. **Reference Folders** - No manual sync needed. The CLI generates these from templates during `uipro init`.

## Prerequisites

`uiux-search`, a compiled Rust binary (no Python, no external runtime dependencies).

## Git Workflow

Never push directly to `main`. Always:

1. Create a new branch: `git checkout -b feat/...` or `fix/...`
2. Commit changes
3. Push branch: `git push -u origin <branch>`
4. Create PR: `gh pr create`
