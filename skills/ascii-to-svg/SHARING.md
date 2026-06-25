# Sharing & installing ascii-to-svg

This skill is a folder of markdown + example SVGs. No build step, **no API keys**,
nothing to compile. There are three ways to get it onto someone's machine; pick
based on how technical they are.

## Recommended: a GitHub repo (best for sharing with several people)

One canonical, versioned source. You fix something once and everyone pulls it.

**You (once):**
```bash
# from the folder that contains ascii-to-svg/
git init && git add . && git commit -m "ascii-to-svg v2.2.0"
git branch -M main
git remote add origin git@github.com:<you>/ascii-to-svg.git
git push -u origin main
# optional: tag a release so non-git folks can grab a zip from the Releases page
git tag v2.2.0 && git push --tags
```

**Them — simplest, always works:**
```bash
git clone https://github.com/<you>/ascii-to-svg.git
cp -r ascii-to-svg ~/.claude/skills/        # personal: every project
# or, to share inside one repo:  cp -r ascii-to-svg .claude/skills/
```
Start a new Claude Code session, then confirm: type `/skills` or ask
"what skills are available?" — `ascii-to-svg` should be listed.

**Them — slick one-command (plugin install):** this folder ships a
`.claude-plugin/plugin.json`, so once your repo has a marketplace manifest it can
be installed with:
```text
/plugin marketplace add <you>/ascii-to-svg
/plugin install ascii-to-svg@<marketplace-name>
```
See https://docs.claude.com/en/docs/claude-code/plugins for the marketplace
manifest format. (The clone-and-copy path above needs no manifest and is the
zero-friction fallback.)

## Zip (best for one or two non-technical recipients)

```bash
# Build a clean zip (no macOS cruft):
zip -r ascii-to-svg.zip ascii-to-svg -x '*/.DS_Store' '*__MACOSX*'
```
They unzip straight into their skills directory:
```bash
unzip ascii-to-svg.zip -d ~/.claude/skills/
```
Trade-off: a zip is a frozen snapshot. When you change the skill you have to
re-send it, and they have to re-unzip. For an evolving skill shared with a group,
GitHub is less work over time.

## Verify it loaded
Start a fresh session and run `/skills` (or `/doctor` if it doesn't show). The
folder must sit **directly** in `~/.claude/skills/ascii-to-svg/` — not nested one
level deeper.

## Optional: enable automatic stale-detection
Auto-detection is off by default; the manual command `Sync ASCII to SVG` always
works. To turn on the hook that flags stale SVGs after markdown edits, register
`hooks/ascii-svg-auto-sync.sh` as a PostToolUse hook (it needs `jq`). See
https://docs.claude.com/en/docs/claude-code/hooks for wiring, and reference the
script portably as `${CLAUDE_SKILL_DIR}/hooks/ascii-svg-auto-sync.sh`.

## Pre-share checklist
- [ ] `xmllint` available on their machine (see REQUIREMENTS.md) — only hard dependency
- [ ] No API keys needed — nothing to configure
- [ ] Folder lands at `~/.claude/skills/ascii-to-svg/` (or project `.claude/skills/`)
- [ ] New Claude Code session started after install
- [ ] `examples/` SVGs render (they're the polished v2.2 style — your "after" preview)

## What this explainer is
`docs/ascii-to-svg-onepager.html` is a self-contained page that shows the
before/after and how the skill works — open it in any browser. It is documentation,
not part of the skill; you can delete it without affecting how the skill runs.
