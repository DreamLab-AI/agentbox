# Playwright Visual Verification

## Purpose
Verify that generated SVGs render correctly by viewing them in a browser.
This is an optional step, only run when user explicitly requests it.

## Prerequisites

Before attempting verification:

1. **Check Playwright is installed:**
   ```bash
   npx playwright --version
   ```
   If not found, skip verification with message:
   "Playwright not installed. Skipping visual verification. Install with: npm install -D playwright"

2. **Check browsers are installed:**
   ```bash
   npx playwright install chromium
   ```

## Verification Process

### Option A: Local File Verification (Default)

Render the SVG directly from the local filesystem:

```javascript
const { chromium } = require('playwright');

async function verifySvg(svgPath) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  // Set viewport
  await page.setViewportSize({ width: 2560, height: 1440 });
  
  // Load SVG directly
  await page.goto(`file://${path.resolve(svgPath)}`);
  
  // Wait for render
  await page.waitForTimeout(500);
  
  // Screenshot
  const screenshotPath = svgPath.replace('.svg', '-verify.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  
  await browser.close();
  
  return screenshotPath;
}
```

### Option B: Markdown Preview Verification

Render the markdown file to verify SVG appears correctly in context:

```javascript
async function verifyMarkdown(mdPath) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 2560, height: 1440 });
  
  // Use a markdown preview tool or GitHub-style renderer
  // Option: use grip (GitHub Readme Instant Preview)
  // Option: use markdown-it with HTML output
  
  const htmlContent = renderMarkdownToHtml(mdPath);
  await page.setContent(htmlContent);
  
  await page.screenshot({ path: 'markdown-preview.png', fullPage: true });
  await browser.close();
}
```

### Option C: GitHub Verification (Requires Prior Push)

If user has already pushed to GitHub and wants to verify rendering there:

```javascript
async function verifyOnGitHub(owner, repo, branch, filePath) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 2560, height: 1440 });
  
  const url = `https://github.com/${owner}/${repo}/blob/${branch}/${filePath}`;
  await page.goto(url, { waitUntil: 'networkidle' });
  
  // Wait for SVG to load
  await page.waitForSelector('img[src*=".svg"]', { timeout: 10000 });
  
  // Screenshot
  await page.screenshot({ path: 'github-preview.png', fullPage: true });
  await browser.close();
}
```

## Verification Checklist

When reviewing screenshots, check:

| Check | Pass Criteria |
|-------|---------------|
| Renders | SVG appears (not broken image icon) |
| Readable | All text is legible, not cut off |
| Layout | Elements match original ASCII structure |
| Spacing | No overlapping elements |
| Arrows | Connections are clear and correct |
| Sizing | Diagram fits viewport reasonably |

## Fix Loop

If issues are detected:

```
┌─────────────────────────────────────────────┐
│  1. Identify issue from screenshot          │
│  2. Modify SVG to fix                       │
│  3. Run xmllint validation                  │
│  4. Re-capture screenshot                   │
│  5. If still broken and attempts < 3: →  2  │
│  6. Report result                           │
└─────────────────────────────────────────────┘
```

Maximum 3 fix attempts per SVG. If still failing, report the issue and continue.

## Common Issues and Fixes

### Text Overflow
**Symptom:** Text extends beyond box boundaries
**Fix:** Increase box width or reduce font size

### Missing Arrows
**Symptom:** Arrows don't appear
**Fix:** Check marker definition exists, verify marker-end references correct ID

### Clipped Edges
**Symptom:** Diagram cut off at edges
**Fix:** Increase viewBox dimensions, add padding

### Broken Characters
**Symptom:** Strange characters or boxes instead of text
**Fix:** Ensure UTF-8 encoding, check entity escaping

### Invisible Elements
**Symptom:** Elements don't appear
**Fix:** Check fill/stroke colors aren't same as background

## Report Format

After verification:

```markdown
## Playwright Verification Results

| SVG | Status | Notes |
|-----|--------|-------|
| architecture.svg | ✅ Pass | Renders correctly |
| auth-flow.svg | ✅ Pass | Fixed text overflow (attempt 2) |
| data-model.svg | ❌ Fail | Could not fix arrow rendering |

Screenshots saved to:
- `assets/diagrams/architecture-verify.png`
- `assets/diagrams/auth-flow-verify.png`
- `assets/diagrams/data-model-verify.png`
```

## Graceful Degradation

If Playwright verification cannot run:

1. **Playwright not installed:**
   "⚠️ Playwright not available. Skipping visual verification. SVGs validated with xmllint only."

2. **Browser launch fails:**
   "⚠️ Could not launch browser. Skipping visual verification."

3. **Screenshot fails:**
   "⚠️ Could not capture screenshot for {file}. Continuing with other files."

Always continue with the conversion process. Verification is a bonus, not a gate.
