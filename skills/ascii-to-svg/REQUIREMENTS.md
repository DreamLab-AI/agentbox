# Requirements

## API keys — none required
This skill does **not** call any external API and needs **no API keys, tokens, or
accounts**. All work happens locally inside your AI coding agent (Claude Code,
or any other tool that reads the `SKILL.md` Agent Skills standard). Nothing is
sent off your machine.

## What you do need

| Requirement | Why | How to get it |
|---|---|---|
| Claude Code (or a SKILL.md-compatible agent) with code execution enabled | Runs the skill and writes the SVG files | https://docs.claude.com/en/docs/claude-code/overview |
| `xmllint` | Validates each generated SVG before it is saved | macOS: `brew install libxml2` · Debian/Ubuntu: `sudo apt-get install libxml2-utils` · Fedora: `sudo dnf install libxml2` · Windows: ships with Git for Windows, or `choco install xsltproc` |

If `xmllint` is missing, the skill still runs — it skips validation and warns you.

## Optional

| Optional tool | Adds | Install |
|---|---|---|
| Node.js + Playwright | Visual screenshot verification of rendered SVGs (`"...and verify with Playwright"`) | `npm i -g playwright && npx playwright install chromium` |
| The bundled auto-sync hook (`hooks/ascii-svg-auto-sync.sh`) | Automatic "this SVG is stale" detection after you edit ASCII | See SHARING.md → Optional: enable auto-detection |

Auto-detection is optional. Without the hook, run `Sync ASCII to SVG` (or
`Show ASCII to SVG status`) whenever you want to check/regenerate.
