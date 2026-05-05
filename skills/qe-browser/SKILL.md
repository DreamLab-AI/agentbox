---
name: qe-browser
description: "QE-grade browser testing with WebDriver BiDi (Vibium). 16 typed assertion kinds, pixel-perfect visual-diff baselines, 14-pattern prompt-injection scanner, 15-intent semantic element finder. Part of the AQE fleet — install with aqe init. Use for typed QE assertions and visual regression; when Playwright is too heavy."
status: requires-install
---

# QE Browser (Vibium)

> ⚠️ **Requires installation.** Run `aqe init` to install this skill and the Vibium WebDriver BiDi engine.

## Install

```bash
aqe init
# This installs the full AQE fleet including qe-browser / Vibium
```

## What it does (after installation)

**Vibium** is a lightweight WebDriver BiDi browser automation engine (10MB vs 300MB for Playwright).

- **16 typed assertion kinds**: element presence, text content, attribute values, computed styles, network responses, accessibility tree, visual diff, etc.
- **Multi-step batch pre-validation**: validates all steps before executing, preventing mid-sequence failures
- **Pixel-perfect visual-diff baselines**: screenshot comparison with configurable thresholds
- **14-pattern prompt-injection scanner**: scans page content for injection attempts
- **15 semantic element intents**: `submit_form`, `accept_cookies`, `primary_cta`, `close_modal`, etc.

## When to use vs alternatives

| Need | Use |
|------|-----|
| QE-grade typed assertions, visual regression | **qe-browser** (this skill) |
| Quick scraping, form fill, minimal context | `browser` |
| Full Playwright API, screenshots, Display :1 | `playwright` |
| Inspect live logged-in Chromium tabs | `chrome-cdp` |
| Unsure which browser tool | `browser-automation` |

## AQE Fleet Integration

After `aqe init`, qe-browser is also used internally by: accessibility-testing, visual-testing, security-visual-testing, compatibility-testing, localization-testing, and 6 other QE fleet skills.
