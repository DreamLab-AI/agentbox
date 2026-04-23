# Nano Banana Prompting Guide

**For:** Art Skill image generation and editing
**Applies to:** Nano Banana 2 (`gemini-3.1-flash-image-preview`) and Nano Banana Pro (`gemini-3-pro-image-preview`)

---

## Model Overview

| Model | API ID | Best For |
|-------|--------|----------|
| **Nano Banana 2** (default) | `gemini-3.1-flash-image-preview` | Fast iteration, most tasks, web search grounding |
| **Nano Banana Pro** | `gemini-3-pro-image-preview` | Professional assets, advanced reasoning, complex compositions |

Both models share the same API surface, prompt patterns, and capabilities below. Nano Banana 2 is ~50% cheaper ($0.067/image vs $0.134) with Pro-level quality at Flash speed. Use Pro when maximum reasoning or complex multi-turn editing is needed.

### Key capabilities shared by both models:

- **Multi-turn editing** — Remembers previous commands for iterative refinement
- **Image blending** — Combine multiple photos into single compositions
- **World knowledge** — Uses Gemini's context for complex semantic edits
- **Style transfer** — Extract visual characteristics from one image, apply to another
- **Consistency** — Maintains subject likeness across different edits and scenes

### Nano Banana 2 exclusive capabilities:

- **Web search grounding** — Real-time web + image search during generation for accurate logos, landmarks, brand identities, and recent events
- **Extended aspect ratios** — 1:4, 4:1, 1:8, 8:1, 2:3, 3:4, 4:5, 5:4 (in addition to standard ratios)
- **512px preview size** — Fast, cheap previews before committing to full resolution
- **Configurable thinking** — Adjust reasoning depth for complex compositions
- **Up to 5 subject consistency** — Maintain character resemblance across generations
- **Up to 14 object fidelity** — Keep visual detail across complex scenes
- **Precision text rendering** — Accurate, legible text for mockups, cards, infographics
- **In-image translation** — Localize text within images across languages

---

## Prompt Structure Best Practices

### The Core Formula

```
[Action] the [Subject] by [Specific Change]. The goal is [Desired Outcome].
```

**Key Principles:**
1. **Be Specific** — Vague prompts produce vague results
2. **Include Context** — Color palettes, brand guidelines, mood
3. **State Purpose** — Who will see this? What's it for?
4. **Use Action Verbs** — Direct commands work best

### Action Verb Vocabulary

| Action | Use For |
|--------|---------|
| **Recolor** | Changing color schemes, palettes |
| **Retouch** | Subtle refinements, cleanup |
| **Style** | Applying artistic treatment |
| **Adjust** | Lighting, composition, positioning |
| **Enhance** | Improving quality, details |
| **Transform** | Major changes, conversions |
| **Add** | Inserting new elements |
| **Remove** | Deleting unwanted objects |
| **Replace** | Swapping one element for another |
| **Blend** | Combining multiple images |

---

## Prompt Templates by Operation

### Creating a Visual Style or Mood

```
[Action] the image of [Subject] to have a [Visual Style, e.g., "high-contrast look," "soft pastel palette"]. The mood should be [Desired Mood, e.g., "energetic," "calm," "luxurious"].
```

**Examples:**
- Retouch the image of the skincare bottle to have a soft, ethereal glow. The mood should be tranquil and clean.
- Recolor the image of the fashion item to have a cinematic feel with deep shadows and rich tones. The mood should be nostalgic and artistic.

### Modifying Specific Elements

```
[Action] the [Subject] in the image by [Specific Change]. The goal is [Desired Outcome].
```

**Examples:**
- Adjust the product in the image by making it brighter and adding a subtle glow. The goal is to make it the focal point.
- Enhance the product texture in the image by sharpening details. The goal is to show material quality clearly.

### Adding Objects

```
Add [object description] to [location/position] in the image. Match the [lighting/perspective/style] of the original.
```

**Examples:**
- Add potted plant to the left side of the desk. Match the ambient lighting and shadow direction.
- Add coffee cup on the table near the laptop. Match the perspective and scale.

### Removing Objects

```
Remove [object] from [position] in the image. Fill naturally with [context clues].
```

**Examples:**
- Remove the coffee stain from the tablecloth. Fill naturally with the fabric pattern.
- Remove the person in the background. Fill naturally with the environment.

### Style Transfer

```
Apply the visual style from [reference description] to [target subject]. Transfer [specific elements, e.g., "colors and textures," "patterns," "lighting style"].
```

**Examples:**
- Apply the visual style of vintage film photography to this modern portrait. Transfer the color grading and grain.
- Apply the texture pattern from the butterfly wings to the dress design. Transfer colors and iridescent quality.

### Environmental/Scene Changes

```
Place [subject] in [new environment]. Maintain [consistency elements]. Adjust lighting to [lighting description].
```

**Examples:**
- Place the product on a white marble surface with soft shadows.
- Transform the indoor scene to evoke an adventurous, free-spirited mood. Add a dramatic sunset glow behind the subjects, and adjust the colors to a vibrant, warm palette of oranges and purples.

---

## Mood and Atmosphere Vocabulary

### Emotional Tones

| Mood | Prompt Phrases |
|------|----------------|
| **Mysterious** | "mysterious and eerie," "atmospheric fog," "shadowy intrigue" |
| **Inviting** | "warm and inviting," "welcoming atmosphere," "friendly glow" |
| **Hostile** | "cold and hostile," "harsh contrasts," "unwelcoming" |
| **Serene** | "peaceful and serene," "calm tranquility," "meditative quiet" |
| **Energetic** | "energetic and dynamic," "vibrant motion," "active energy" |
| **Nostalgic** | "nostalgic and vintage," "retro warmth," "timeworn quality" |
| **Luxurious** | "opulent and luxurious," "premium quality," "refined elegance" |
| **Whimsical** | "playful and whimsical," "fantastical elements," "dreamlike" |

### Color Palette Phrases

| Palette Type | Prompt Phrases |
|--------------|----------------|
| **Warm** | "warm tones," "golden hour colors," "amber and coral" |
| **Cool** | "cool blues and greens," "icy tones," "winter palette" |
| **Muted** | "muted pastels," "desaturated colors," "soft palette" |
| **Vibrant** | "saturated vibrant colors," "bold palette," "high-energy hues" |
| **Monochromatic** | "monochromatic scheme," "single color variations," "tonal range" |
| **High-contrast** | "high-contrast look," "deep shadows rich highlights," "dramatic lighting" |
| **Soft** | "soft, ethereal glow," "diffused lighting," "gentle transitions" |

---

## Aspect Ratio Selection

### Pre-Generation Checklist

**Before generating images for UI components:**
1. **Ask for target dimensions** — What's the actual pixel size or aspect ratio of the container?
2. **Verify "vertical" vs specific ratio** — "Vertical" is ambiguous; 9:16 ≠ 2:3 ≠ 3:4
3. **Check platform constraints** — Newsletter forms, sidebars, and widgets have specific proportions
4. **Consider responsive behavior** — Will the image be cropped or scaled at different breakpoints?

**Common UI component ratios:**
| Component | Typical Ratio |
|-----------|---------------|
| Newsletter signup form (vertical) | 9:16 or narrower |
| Sidebar widget | 3:4 or 2:3 |
| Hero banner | 16:9 or 21:9 |
| Card thumbnail | 16:9 or 4:3 |
| Profile/avatar | 1:1 |

### Standard Aspect Ratios (both models)

| Ratio | Use Case |
|-------|----------|
| **1:1 (Square)** | Social media posts, profile images, thumbnails |
| **16:9 (Landscape)** | Blog headers, YouTube thumbnails, presentations |
| **9:16 (Portrait)** | Stories, mobile wallpapers, vertical video covers, narrow form backgrounds |
| **4:3** | Presentations, traditional photos |
| **3:2** | Classic photography, print-ready |
| **21:9 (Ultrawide)** | Cinematic headers, panoramic |

### Extended Aspect Ratios (Nano Banana 2 only)

| Ratio | Use Case |
|-------|----------|
| **3:4** | Portrait photography, book covers |
| **2:3** | Tall portrait, phone wallpapers |
| **4:5** | Instagram portrait, social cards |
| **5:4** | Slightly wider than square, print |
| **1:4** | Ultra-tall banners, vertical strips |
| **4:1** | Ultra-wide banners, horizontal strips |
| **1:8** | Extreme vertical (sidebar, scroll) |
| **8:1** | Extreme horizontal (panoramic banner) |

---

## Thinking Levels (Nano Banana 2 only)

The `--thinking` flag gives the model extra reasoning time before generating. Thinking is always on — `minimal` is the default. You're billed for thinking tokens regardless of level.

| Level | Best For |
|-------|----------|
| `minimal` | Default — balances quality and latency for most tasks |
| `high` | Complex layouts, exact positioning, multi-element compositions |

> **Note:** The official API documents `minimal` and `high`. Other levels (`low`, `medium`) are accepted by the CLI but may map to these two internally.

**When to use `--thinking high`:**
- Prompt describes 3+ distinct elements with specific spatial relationships
- Previous generation placed elements incorrectly
- Style transfer needs to be precise
- Architecture/diagram-style images with labeled components
- Text-heavy images where placement matters

**When to stay on `minimal` (default):**
- Simple single-subject images
- Fast iteration / exploration phase
- 512px previews (speed matters more)

---

## Iterative Refinement Workflow

Nano Banana Pro remembers context across turns. Use this for progressive refinement:

### The Pattern

1. **Start Basic** — Generate initial composition
2. **Add Details Gradually** — One change per turn
3. **Explore Styles** — Try different artistic approaches
4. **Test Elements** — Add/remove to find optimal composition
5. **Color Experiment** — Test various palettes
6. **Final Polish** — Fine-tune lighting and mood

### Example Multi-Turn Session

```
Turn 1: "Generate a blog header showing interconnected nodes representing AI systems on cream background"

Turn 2: "Make the connections more prominent with teal highlights"

Turn 3: "Add subtle burnt orange accents to the key central node"

Turn 4: "Soften the shadows and increase the hand-drawn sketch quality"

Turn 5: "Remove the bottom-left node, it's too cluttered"
```

---

## Integration with Brand Aesthetics

When generating images for a specific brand, combine these prompt patterns with your aesthetic file's Base Prompt Prefix:

### Brand Image Prompt Template

```
[Action] to create a [content type] in [your aesthetic style].

SUBJECT: [describe 2-4 key elements]

STYLE: [your style parameters from aesthetic.md]

ACCENTS:
- Primary: [your primary accent color] highlights on [focal element]
- Secondary: [your secondary accent color] highlights on [action element]

MOOD: [Select from vocabulary above]

COMPOSITION: [your composition rules from aesthetic.md]
```

---

## Common Issues and Fixes

| Problem | Solution |
|---------|----------|
| **Too polished/vector-like** | Add "rough, imperfect, hand-drawn strokes" |
| **Wrong color intensity** | Specify exact hex codes and "muted/soft/vibrant" |
| **Cluttered composition** | Explicitly state "2-4 elements maximum, generous negative space" |
| **Inconsistent style** | Use reference image via `--reference-image` flag |
| **Wrong mood** | Use specific mood vocabulary from table above |
| **Element placement wrong** | Specify exact position: "top-left," "centered," "bottom-right" |

---

## Web Search Grounding (Nano Banana 2 only)

Nano Banana 2 can search the web in real-time during image generation. This means it can accurately render things it hasn't seen in training data: recent logos, current landmarks, brand identities, recent events.

**What it enables:**
- Accurate brand logos and product packaging
- Real landmarks and buildings as they currently look
- Recent public figures and events
- Specific visual references the model can look up

**How to use in our CLI:** Add `--grounded` to enable web search during generation. The API receives `tools: [{ googleSearch: {} }]`, and the response includes grounding metadata — source URLs and the search queries the model used.

```bash
bun run ~/.claude/skills/art/tools/generate-image.ts \
  --prompt "The Sagrada Familia at golden hour, photorealistic" \
  --grounded --size 2K --output /tmp/sagrada.png
```

The CLI logs grounding sources and search queries after generation, so you can see what the model looked up.

**Prompt tip:** When you need accuracy for a known subject, be extremely specific: "the Tesla Cybertruck" not "a futuristic truck", "the Sagrada Familia in Barcelona" not "an ornate cathedral."

---

## Text Rendering

Nano Banana 2 has significantly improved text rendering over previous models. It can generate accurate, legible text inside images — useful for mockups, greeting cards, infographics, and marketing assets.

**What works well:**
- Short text (titles, headings, labels, button text)
- Marketing mockups with product names
- Greeting cards and invitations
- Infographic labels and data callouts
- Translated/localized text within images

**Prompting for text:**
- Spell out the exact text you want in quotes: `with the text "Your Brand" centered at the top`
- Specify font style: "bold sans-serif", "handwritten script", "monospace"
- Specify placement: "text centered below the icon", "title in the upper third"
- For multi-language: "translate the heading to Spanish" works in-context

**Limitations (still apply):**
- Long paragraphs will likely garble
- Very small text at low resolution may be illegible
- Complex typography (kerning, ligatures) is inconsistent
- For production text, still best to **generate artwork first, composite text separately** (as per existing SKILL.md guidance)

---

## Subject Consistency and Multi-Object Limits

| Model | Max Consistent Characters | Max High-Fidelity Objects | Max Reference Images |
|-------|--------------------------|--------------------------|---------------------|
| **Nano Banana 2** | 5 | 14 | Up to 14 combined |
| **Nano Banana Pro** | 5 | 6 | Up to 6 combined |

**What this means in practice:**
- NB2 can keep faces, outfits, and features stable across up to 5 characters in a scene
- It can maintain visual detail on up to 14 distinct objects (props, furniture, background elements)
- Instruction following is tighter than previous Flash models — less "freestyling" on detailed prompts

**Prompt tip for multi-subject scenes:**
- Name each character or object explicitly
- Describe distinguishing features: "the woman in the red jacket", "the tall man with glasses"
- Specify spatial relationships: "standing to the left of", "sitting behind the desk"

---

## Semantic World Knowledge

Both models apply real-world knowledge beyond pure aesthetics. Use this for complex, realistic edits:

### Physics-Based Interactions

The model understands physical properties:
- **Gravity** — Objects fall naturally, clothing drapes correctly
- **Shadows** — Cast shadows adjust to lighting changes
- **Reflections** — Surfaces reflect added objects appropriately
- **Weight** — Heavy objects affect surfaces they sit on

**Prompt tip:** When adding objects, specify "with natural shadows and reflections matching the scene lighting."

### Cultural Context Understanding

The model recognizes appropriate context:
- Clothing appropriate to settings and occasions
- Cultural symbols and their meanings
- Professional vs casual environments
- Regional architectural styles

**Prompt tip:** Include cultural context like "professional office setting" or "casual beach environment."

### Temporal Awareness

The model understands time-related contexts:
- Seasonal changes (snow, fall leaves, spring blooms)
- Time of day (golden hour, midday, night)
- Era-appropriate elements (vintage vs modern)
- Weather conditions

**Prompt tip:** Specify temporal context like "golden hour lighting" or "overcast winter day."

### Practical Applications

| Edit Type | Semantic Knowledge Used |
|-----------|------------------------|
| Add person to scene | Cultural dress, natural posture, appropriate scale |
| Change time of day | Shadow direction, lighting color, ambient mood |
| Place product in environment | Surface reflections, shadow casting, perspective |
| Style transfer with context | Preserve semantic meaning while changing aesthetics |

---

## Reference Image Usage

When using `--reference-image` with Nano Banana 2 or Nano Banana Pro:

```bash
bun run ~/.claude/skills/art/tools/generate-image.ts \
  --model nano-banana-2 \
  --prompt "[Your prompt including style transfer instructions]" \
  --reference-image /path/to/reference.png \
  --size 2K \
  --aspect-ratio 16:9
```

**What the reference image provides:**
- Visual style guidance (colors, textures, mood)
- Composition reference
- Subject consistency across variations
- Brand alignment for matching existing assets

**Per-model reference limits:**

| Model | Max Character References | Max Object References | Combined Max |
|-------|------------------------|----------------------|-------------|
| **Nano Banana 2** | 4 | 10 | 14 |
| **Nano Banana Pro** | 5 | 6 | ~6 total |

> Our CLI currently supports a single `--reference-image`. For multi-reference workflows, use the API directly.

---

## Pricing Reference

| Model | Cost per Image | Input Tokens | Output Tokens |
|-------|---------------|-------------|--------------|
| **Nano Banana 2** | ~$0.067 | $0.50/M | $3.00/M |
| **Nano Banana Pro** | ~$0.134 | $1.25/M | $5.00/M |

Prompt tokens are negligible (50-200 tokens per prompt = ~$0.0001). Thinking tokens are billed regardless of level. NB2 is roughly **50% cheaper** than Pro for equivalent quality.

---

## Credits

Prompt techniques adapted for the Art Skill. Updated 2026-02-26 with Nano Banana 2 details.
