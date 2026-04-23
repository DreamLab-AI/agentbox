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

### Button Variants

```html
<button class="btn">Default</button>
<button class="btn btn-primary">Primary</button>
<button class="btn btn-secondary">Secondary</button>
<button class="btn btn-accent">Accent</button>
<button class="btn btn-ghost">Ghost</button>
<button class="btn btn-link">Link</button>
<button class="btn btn-outline btn-primary">Outlined</button>
```

### Card

```html
<div class="card bg-base-100 shadow-xl">
  <figure><img src="image.jpg" alt="Card" /></figure>
  <div class="card-body">
    <h2 class="card-title">Title</h2>
    <p>Description text</p>
    <div class="card-actions justify-end">
      <button class="btn btn-primary">Action</button>
    </div>
  </div>
</div>
```

### Modal

```html
<button class="btn" onclick="my_modal.showModal()">Open</button>
<dialog id="my_modal" class="modal">
  <div class="modal-box">
    <h3 class="font-bold text-lg">Title</h3>
    <p class="py-4">Content here</p>
    <div class="modal-action">
      <form method="dialog">
        <button class="btn">Close</button>
      </form>
    </div>
  </div>
</dialog>
```

### Navbar

```html
<div class="navbar bg-base-100">
  <div class="flex-1">
    <a class="btn btn-ghost text-xl">Brand</a>
  </div>
  <div class="flex-none">
    <ul class="menu menu-horizontal px-1">
      <li><a>Link 1</a></li>
      <li><a>Link 2</a></li>
    </ul>
  </div>
</div>
```

### Drawer Layout

```html
<div class="drawer lg:drawer-open">
  <input id="drawer" type="checkbox" class="drawer-toggle" />
  <div class="drawer-content">
    <!-- Page content -->
    <label for="drawer" class="btn btn-primary drawer-button lg:hidden">Menu</label>
  </div>
  <div class="drawer-side">
    <label for="drawer" aria-label="close sidebar" class="drawer-overlay"></label>
    <ul class="menu bg-base-200 text-base-content min-h-full w-80 p-4">
      <li><a>Sidebar Item 1</a></li>
      <li><a>Sidebar Item 2</a></li>
    </ul>
  </div>
</div>
```

## Themes

### Apply a Theme

```html
<html data-theme="dark">
<!-- or any of 35+ built-in themes -->
```

### Built-in Themes

`light` `dark` `cupcake` `bumblebee` `emerald` `corporate` `synthwave` `retro` `cyberpunk` `valentine` `halloween` `garden` `forest` `aqua` `lofi` `pastel` `fantasy` `wireframe` `black` `luxury` `dracula` `cmyk` `autumn` `business` `acid` `lemonade` `night` `coffee` `winter` `dim` `nord` `sunset` `caramellatte` `abyss` `silk`

### Custom Theme

```css
@plugin "daisyui" {
  themes: light --default, dark,
  mytheme {
    primary: oklch(65% 0.3 340);
    secondary: oklch(70% 0.25 200);
    accent: oklch(75% 0.2 150);
    neutral: oklch(40% 0.02 264);
    base-100: oklch(98% 0.01 264);
  }
}
```

### Theme Switcher Pattern

```html
<select data-choose-theme class="select select-bordered">
  <option value="light">Light</option>
  <option value="dark">Dark</option>
  <option value="cyberpunk">Cyberpunk</option>
</select>

<script>
  // Use theme-change package or manual:
  document.querySelector('[data-choose-theme]').addEventListener('change', (e) => {
    document.documentElement.setAttribute('data-theme', e.target.value);
  });
</script>
```

## Tips

1. **Always set data-theme** on `<html>` -- components inherit colours from the active theme
2. **Use semantic colour classes** (`btn-primary`, `bg-base-200`) not raw Tailwind colours -- themes swap automatically
3. **Combine with Tailwind utilities** -- `btn btn-primary w-full mt-4` works naturally
4. **Responsive modifiers work** -- `btn btn-sm lg:btn-lg` scales with breakpoints
5. **Component modifiers stack** -- `btn btn-primary btn-outline btn-sm` combines cleanly
6. **Use MCP for accuracy** -- the Blueprint or Context7 MCP provides real-time component API docs to avoid hallucinated classes
7. **v5 uses oklch colours** -- custom themes use oklch colour space, not hex
8. **Check version** -- daisyUI 5 (current) differs from v4. Ensure your installed version matches the docs
