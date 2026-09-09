---
name: daisyui
description: >
  Build UI components with daisyUI (Tailwind CSS component library). Provides theme configuration,
  component patterns, and MCP server integration for accurate daisyUI 5 code generation.
  Use when creating web interfaces with daisyUI components, configuring themes, or generating
  Tailwind-based UI layouts.
---

# daisyUI Skill

Generate accurate daisyUI 5 components and themes with MCP-enhanced context.

## When Not To Use

- For general CSS/Tailwind without daisyUI components -- write Tailwind directly
- For React/Vue/Svelte component architecture -- use the ui-ux-pro-max-skill instead
- For visual testing of rendered UI -- use the browser-automation or playwright skills
- For design system creation without Tailwind -- use standard CSS approaches

## MCP Server Setup

Three options ranked by capability. Choose ONE and add to Claude Code.

Claude Code only: `claude mcp add` is the Claude Code CLI's registration command. On Codex / GPT-6 Astra: register the equivalent server in `~/.codex/config.toml` under `[mcp_servers.<name>]` instead.

### Option 1: daisyUI Blueprint (Official, Recommended)

Full component library context with Figma-to-code support. Requires license.

```bash
claude mcp add daisyui-blueprint \
  --env LICENSE=YOUR_LICENSE_KEY \
  --env EMAIL=YOUR_EMAIL \
  --env FIGMA=YOUR_FIGMA_API_KEY \
  -- npx -y daisyui-blueprint@latest
```

Figma API key is optional -- only needed for Figma-to-code conversion.

**Usage**: Include "use Blueprint MCP" at prompt end.

### Option 2: Context7 MCP Server (Free)

Community documentation context. No license required.

```bash
# HTTP transport (recommended)
claude mcp add --transport http context7 https://mcp.context7.com/mcp

# Or local server
claude mcp add context7 -- npx -y @upstash/context7-mcp
```

**Usage**: Include "use context7" at prompt end.

### Option 3: daisyUI GitMCP Server (Free)

Direct repository documentation context.

```bash
claude mcp add --transport http daisyui https://gitmcp.io/saadeghi/daisyui
```

**Usage**: Context is automatic -- no suffix needed.

## Quick Start

### Install daisyUI in a Project

```bash
npm install daisyui@latest
```

### Tailwind CSS v4 Configuration

```css
/* app.css */
@import "tailwindcss";
@plugin "daisyui";
```

### Tailwind CSS v3 Configuration

```js
// tailwind.config.js
module.exports = {
  plugins: [require("daisyui")],
}
```

## Component Patterns

Button, card, modal, navbar and drawer snippets moved to
[references/components.md](references/components.md) — read on demand rather
than duplicating them here.

## Themes

Theme application, the built-in theme list, custom-theme authoring and the
theme-switcher pattern moved to [references/themes.md](references/themes.md).

## Tips

1. **Always set data-theme** on `<html>` -- components inherit colours from the active theme
2. **Use semantic colour classes** (`btn-primary`, `bg-base-200`) not raw Tailwind colours -- themes swap automatically
3. **Combine with Tailwind utilities** -- `btn btn-primary w-full mt-4` works naturally
4. **Responsive modifiers work** -- `btn btn-sm lg:btn-lg` scales with breakpoints
5. **Component modifiers stack** -- `btn btn-primary btn-outline btn-sm` combines cleanly
6. **Use MCP for accuracy** -- the Blueprint or Context7 MCP provides real-time component API docs to avoid hallucinated classes
7. **v5 uses oklch colours** -- custom themes use oklch colour space, not hex
8. **Check version** -- daisyUI 5 (current) differs from v4. Ensure your installed version matches the docs
