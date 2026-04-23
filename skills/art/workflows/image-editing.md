# Image Editing Workflow

**For:** Modifying, enhancing, or transforming existing images

---

## When to Use This Workflow

- User has an existing image to modify
- Need to add, remove, or replace elements
- Style transfer from reference to target
- Color/mood adjustments to existing visuals
- Product photography touch-ups
- Scene/environment changes

---

## Prerequisites

- Source image file (PNG, JPEG, WebP)
- Clear description of desired changes
- Nano Banana 2 configured (`GOOGLE_API_KEY` in `~/.claude/.env`)

---

## Quick Reference: Edit Operations

| Operation | Prompt Pattern |
|-----------|----------------|
| **Add** | "Add [object] to [position]. Match the [lighting/style]." |
| **Remove** | "Remove [object] from [area]. Fill naturally with [context]." |
| **Replace** | "Replace [old element] with [new element]. Maintain [consistency]." |
| **Recolor** | "Change the color of [element] to [new color/palette]." |
| **Style** | "Apply [style description] to this image." |
| **Mood** | "Adjust the mood to be [desired mood]. Use [lighting/color changes]." |
| **Enhance** | "Enhance [element] by [specific improvement]." |
| **Transform** | "Transform this [scene type] into [new scene type]." |

---

## Workflow Steps

### Step 1: Analyze Source Image

Before editing, understand:
- Current composition and focal points
- Lighting direction and quality
- Color palette and mood
- What needs to change and why

### Step 2: Craft Edit Prompt

Use the action verb + subject + change + goal pattern:

```
[Action] the [subject/element] in this image by [specific change].
The goal is [desired outcome].
```

### Step 3: Execute Edit

```bash
bun run ~/.claude/skills/art/tools/generate-image.ts \
  --prompt "[Your edit prompt]" \
  --reference-image /path/to/source-image.png \
  --size 2K \
  --aspect-ratio [match source or specify new]
```

### Step 4: Iterate if Needed

Nano Banana supports multi-turn refinement. Chain edits:

1. First edit: Major change
2. Second edit: Refinement
3. Third edit: Final polish

---

## Edit Type Templates

### Element Addition

**Prompt Template:**
```
Add [detailed object description] to [precise location] in this image.

INTEGRATION:
- Match the existing lighting direction and intensity
- Scale appropriately to the scene perspective
- Generate consistent shadows matching the scene
- Blend edges naturally with surroundings
```

**Example:**
```
Add a potted succulent plant to the left side of the desk in this image.

INTEGRATION:
- Match the soft window lighting from the right
- Scale to be about 15cm tall relative to the laptop
- Generate a soft shadow falling left
- Blend naturally with the wooden desk surface
```

### Element Removal

**Prompt Template:**
```
Remove [object to remove] from [location] in this image.

FILL:
- Reconstruct [what should appear] in the removed area
- Maintain [texture/pattern] consistency
- Preserve [lighting/shadow] continuity
```

**Example:**
```
Remove the coffee mug from the right side of the desk in this image.

FILL:
- Reconstruct the wooden desk surface texture
- Maintain the grain pattern consistency
- Preserve the natural lighting from the window
```

### Style Transfer

**Prompt Template:**
```
Apply the visual style of [style description or reference] to this image.

TRANSFER:
- [Color treatment]: [specific color changes]
- [Texture quality]: [smooth/grainy/etc.]
- [Lighting style]: [dramatic/soft/flat/etc.]
- [Overall mood]: [specific mood]

PRESERVE:
- [Elements to keep unchanged]
```

**Example:**
```
Apply vintage film photography style to this portrait image.

TRANSFER:
- Color treatment: Warm, slightly desaturated with lifted blacks
- Texture quality: Add subtle film grain
- Lighting style: Soft, diffused, golden hour warmth
- Overall mood: Nostalgic and timeless

PRESERVE:
- Subject's face and expression
- Basic composition
```

### Mood/Atmosphere Change

**Prompt Template:**
```
Transform the mood of this image to [target mood].

ADJUSTMENTS:
- Lighting: [specific lighting change]
- Colors: [palette shift]
- Atmosphere: [add fog/glow/shadows/etc.]
- Tone: [warm/cool/neutral]
```

**Example:**
```
Transform the mood of this office photo to be more creative and energetic.

ADJUSTMENTS:
- Lighting: Brighter, with warm accent highlights
- Colors: Shift to warmer palette with pops of teal and orange
- Atmosphere: Add subtle morning sunlight rays from window
- Tone: Warm and inviting
```

### Product Enhancement

**Prompt Template:**
```
Enhance this product photo for [purpose, e.g., "e-commerce listing"].

IMPROVEMENTS:
- [Lighting adjustment]
- [Background treatment]
- [Product focus enhancement]
- [Color accuracy]
```

**Example:**
```
Enhance this product photo for a premium brand website.

IMPROVEMENTS:
- Lighting: Soft, even studio lighting with subtle highlights
- Background: Clean white with gentle shadow for grounding
- Product focus: Sharpen product details, blur any background distractions
- Color accuracy: True-to-life colors with slight saturation boost
```

---

## Brand Style Edit Integration

When editing images to match your brand aesthetic:

### Convert to Brand Style

```
Transform this [image type] into your brand aesthetic.

STYLE:
- Apply hand-drawn Excalidraw sketch quality to lines and edges
- Shift background to warm cream (#F7F4EA)
- Add deep teal (#1A6B6B) accents to focal elements
- Add burnt orange (#C85A2A) highlights to action elements
- Soften to casual, approachable warmth

PRESERVE:
- Core concept and composition
- Key information hierarchy
```

---

## Multi-Turn Editing Session

For complex edits, use progressive refinement:

```
Turn 1: "Make the background warmer and less cluttered"
Turn 2: "Now add teal highlights to the main subject"
Turn 3: "Soften the shadows slightly"
Turn 4: "Add subtle burnt orange accent to the call-to-action area"
```

Each turn builds on the previous result. The model maintains context.

---

## Common Editing Challenges

| Challenge | Solution |
|-----------|----------|
| **Edit doesn't integrate naturally** | Explicitly specify "match lighting/perspective/shadows" |
| **Too aggressive changes** | Use "subtle" and "slight" modifiers |
| **Lost image quality** | Start from highest resolution source |
| **Inconsistent style** | Reference specific style elements to preserve |
| **Unwanted changes to other areas** | Specify "only modify [area], preserve everything else" |

---

## Output Considerations

- **Format:** PNG for quality, WebP for smaller files
- **Resolution:** Match or exceed source resolution
- **Color space:** Ensure consistency with source
- **Backup:** Always keep original source image

---

## See Also

- `nano-banana-guide.md` — Full prompt vocabulary and templates
- `aesthetic.md` — Brand styling reference
- `generate-image.ts --help` — CLI options and parameters
