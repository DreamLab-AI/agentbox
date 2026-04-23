# Custom Aesthetics

This directory holds brand-specific aesthetic definitions. Each `.md` file defines a complete visual identity that the art skill uses when generating images for that brand.

## How It Works

When you tell Claude to generate an image "using my-brand aesthetic," the skill reads `aesthetics/my-brand.md` and applies its colors, line style, composition rules, and base prompt prefix to ensure visual consistency.

## Creating a New Aesthetic

1. Copy the example aesthetic at `../aesthetic.md` as your starting template
2. Save it as `aesthetics/your-brand.md`
3. Replace all values with your brand's visual identity:
   - Core concept and philosophy
   - Color system (backgrounds, lines, accents)
   - Line/rendering style
   - Composition rules
   - **Base Prompt Prefix** (mandatory -- this is the consistency lock)
4. Reference it when generating: "Create a header using your-brand aesthetic"

## Required Sections

Every aesthetic file must include:

| Section | Purpose |
|---------|---------|
| Core Concept | One-sentence visual philosophy |
| Style Direction | What to aim for and what to avoid |
| Color System | Backgrounds, lines/surfaces, accent colors with hex codes |
| Composition Rules | Layout guidelines, element counts, negative space |
| **Base Prompt Prefix** | Locked prompt block prepended to every generation |
| Consistency Lock Parameters | Table of locked values and rationale |

## Base Prompt Prefix

The most important section. This is a paragraph of locked prompt parameters that gets prepended to every image generation call for this aesthetic. It ensures all images in a set look cohesive.

Example from the default aesthetic:

```
Hand-drawn editorial illustration in rough sketch style on warm cream paper
background. Medium-weight charcoal ink pen lines with wobbly hand-drawn quality...
```

Without a base prompt prefix, the aesthetic is considered incomplete.

## Tips

- Keep accent colors to 2-3 maximum for visual cohesion
- Define what to AVOID as clearly as what to aim for
- Include AI generation signal phrases (positive and negative)
- Test your prefix by generating 5+ images and checking consistency
