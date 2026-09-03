# Example Workflow

**User request:** "Làm landing page cho dịch vụ chăm sóc da chuyên nghiệp"

## Step 1: Analyze Requirements
- Product type: Beauty/Spa service
- Style keywords: elegant, professional, soft
- Industry: Beauty/Wellness
- Stack: html-tailwind (default)

## Step 2: Generate Design System (REQUIRED)

```bash
uiux-search "beauty spa wellness service elegant" --design-system -p "Serenity Spa"
```

**Output:** Complete design system with pattern, style, colors, typography, effects, and anti-patterns.

## Step 3: Supplement with Detailed Searches (as needed)

```bash
# Get UX guidelines for animation and accessibility
uiux-search "animation accessibility" --domain ux

# Get alternative typography options if needed
uiux-search "elegant luxury serif" --domain typography
```

## Step 4: Stack Guidelines

```bash
uiux-search "layout responsive form" --stack html-tailwind
```

**Then:** Synthesize design system + detailed searches and implement the design.
