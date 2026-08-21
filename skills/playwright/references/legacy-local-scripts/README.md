# Legacy local-Playwright scripts (historical — do NOT run)

These Node scripts predate the sidecar migration. They `require('playwright')`
and launch a **local** Chromium via a local `playwright` npm dependency
(`package.json` pinned `playwright ^1.57.0`, `package-lock.json`). That path is
**retired**: the skill now drives Chrome exclusively through the
`browsercontainer` sidecar over `chrome-devtools-mcp` (see the parent
`SKILL.md`). There is no local browser and no local `playwright` install.

They are kept only as **historical worked examples** of the flows the skill was
used for — auth/hero walkthroughs and email/content quality-filter checks
against `dreamlab-ai.github.io/fairfield`. To reproduce any of these today,
re-express the flow with the sidecar MCP tools (`browser_navigate`,
`browser_click`, `browser_take_screenshot`, `browser_evaluate`, …) instead of
`chromium.launch()`.

| File | What it did |
|------|-------------|
| `hero-test.js` | Homepage → Create Account → Generate Keys → auth-state screenshots |
| `debug-vf.js` | Debug harness for the visual/content filter |
| `quality-gate-test.js` | Quality-gate content check |
| `test-filter.js` / `verify-filtering.js` / `vf-check.js` | Content-filter verification runs |
| `resolve-chromium.js` | Resolved a local Chromium binary path (local-browser era) |
| `package.json` / `package-lock.json` | Pinned the retired local `playwright` dependency |
