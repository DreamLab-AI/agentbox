# Visual Design Standards

Color, contrast, and typography detail. For responsive typography scaling see also
[responsive-design.md](./responsive-design.md).

## Color & Contrast

### Color System Architecture

Every interface needs two color roles:

1. **Base/Neutral Palette (4-5 colors):**
   - Backgrounds (lightest)
   - Surface colors (cards, inputs)
   - Borders and dividers
   - Text (darkest)
   - Use slightly desaturated, warm or cool greys based on brand

2. **Accent Palette (1-3 colors):**
   - Primary action (CTA buttons)
   - Status indicators (success, warning, error, info)
   - Focus/hover states
   - Use saturated colors for clear contrast against neutrals

**Palette Structure Example:**
```
Neutrals: slate-50, slate-100, slate-300, slate-700, slate-900
Accents: teal-500 (primary), amber-500 (warning), red-500 (error)
```

### Color Application Rules

- **Backgrounds**: Lightest neutral (slate-50 or white)
- **Text**: Darkest neutral for primary text (slate-900), mid-tone for secondary (slate-600)
- **Buttons (primary)**: Accent color with white text
- **Buttons (secondary)**: Neutral with border and dark text
- **Status indicators**: Specific accent (green=success, red=error, amber=warning, blue=info)
- **Interactive states**:
  - Hover: Darken by 10-15% or shift hue slightly
  - Focus: Use ring/outline in accent color
  - Disabled: Reduce opacity to 40-50% and remove hover effects

### Color Relationships

Choose warm or cool intentionally based on brand:
- **Warm greys** (beige/brown undertones): Organic, approachable, trustworthy
- **Cool greys** (blue undertones): Modern, tech-forward, professional

Accent colors should have clear contrast with both:
- Light backgrounds (for buttons on white)
- Dark text (if used as backgrounds for white text)

### Intentional Color Usage
- Every color must serve a purpose (hierarchy, function, status, or action)
- Avoid decorative colors that don't communicate meaning
- Maintain consistency: same color = same meaning throughout

### Accessibility
- Ensure sufficient contrast for color-blind users
- Follow WCAG 2.1 AA: minimum 4.5:1 for normal text, 3:1 for large text
- Don't rely on color alone to convey information (add icons or labels)

### Unique Color Strategy

To stand out from generic patterns:
- Avoid default SaaS blue (#3B82F6) unless it fits your brand
- Consider unexpected neutrals: warm greys, soft off-whites, deep charcoals
- Pair neutrals with distinctive accents: terracotta + charcoal, sage + navy, coral + slate
- Test combinations against "does this look AI-generated?" filter

## Typography Excellence

Typography is a primary design element that conveys personality and hierarchy.

**Functional vs Emotional Typography:**
- **Headlines/Display**: Prioritize emotion, personality, attention (legibility secondary)
- **Body Text**: Prioritize legibility, reading comfort, accessibility
- **UI/Labels**: Prioritize clarity, scannability, consistency

### Font Selection
- Use 2-3 typefaces maximum
- Limit to 3 weights per typeface (e.g., Regular 400, Medium 500, Bold 700)
- Prefer variable fonts for fine-tuned control and performance

**Font Version Usage:**
- **Display version**: Headlines and hero text only
- **Text version**: Paragraphs and long-form content
- **Caption/Micro**: Small UI labels (1-2 lines, non-critical info)

**Recommended Sources:**
- Google Fonts for web (free, well-optimized, reliable)
- System fonts for performance-critical apps (-apple-system, BlinkMacSystemFont, Segoe UI)
- Choose fonts that serve your brand's purpose (not "trending" lists)

### Typographic Scale

Use mathematical relationships for size hierarchy:
- **Ratio**: Major third (1.25x) for moderate contrast, Perfect fourth (1.333x) for dramatic
- **Base size**: 16px (1rem) for body text
- **Example scale (1.25x)**:
  ```
  xs:   0.64rem (10px)
  sm:   0.8rem  (13px)
  base: 1rem    (16px)
  lg:   1.25rem (20px)
  xl:   1.563rem (25px)
  2xl:  1.953rem (31px)
  3xl:  2.441rem (39px)
  4xl:  3.052rem (49px)
  5xl:  3.815rem (61px)
  ```

**Typographic Hierarchy:**
- Create clear visual distinction between levels
- Headlines, subheadings, body, captions should each have distinct size/weight
- Use combination of size, weight, and color for hierarchy

### Spacing & Readability
- **Line height**: 1.5x font size for body text (e.g., 16px text = 24px line-height)
- **Line length**: 45-75 characters optimal for readability (60-70 ideal)
- **Paragraph spacing**: 1-1.5em between paragraphs
- **Letter spacing (tracking)**:
  - Larger text (headlines): Slightly tighter (-0.02em to -0.05em)
  - Normal text (body): Default (0)
  - Small text (captions): Slightly looser (+0.01em to +0.03em)
  - General rule: As size increases, reduce tracking; as size decreases, increase tracking

### Font Pairing Logic

When using multiple typefaces, create contrast through:
- **Category contrast**: Serif + Sans-serif (classic, clear distinction)
- **Weight contrast**: Light + Bold (dynamic, energetic)
- **Personality contrast**: Geometric + Humanist (modern + warm)

Examples:
- Serif headlines + Sans body (editorial, trustworthy)
- Display headlines + System body (distinctive + efficient)
- Bold sans headlines + Light sans body (modern, clean)

### UI Typography

Specific guidance for interface elements:
- **Button text**: Semi-Bold (600), 14-16px, consistent casing (all-caps OR title case)
- **Form labels**: Regular (400), 14px, positioned above input
- **Form input text**: Regular (400), 16px minimum (prevents iOS zoom on focus)
- **Placeholder text**: Light (300) or desaturated color, same size as input
- **Error messages**: Regular (400), 12-14px, color-coded (red-ish)

### Responsive Typography

Scale type sizes across breakpoints:
```tsx
// Example with Tailwind
<h1 className="text-3xl md:text-4xl lg:text-5xl">
  Responsive Headline
</h1>

// Or with CSS clamp (fluid)
h1 {
  font-size: clamp(2rem, 5vw, 4rem);
}
```

Reduce sizes on mobile (20-30% smaller than desktop). Reduce hierarchy levels on
small screens (fewer distinct sizes).

## Layout & Spatial Design

**Compositional Balance:**
- Every screen should feel balanced
- Pay attention to visual weight and negative space
- Use generous negative space to focus attention
- Add sufficient margins and paddings for professional, spacious look

**Grid Discipline:**
- Maintain consistent underlying grid system
- Create sense of order while allowing meaningful exceptions
- Use grid/flex wrappers with `gap` for spacing
- Prioritize wrappers over direct margins/padding on children

**Spatial Relationships:**
- Group related elements through proximity, alignment, and shared attributes
- Use size, color, and spacing to highlight important elements
- Guide user focus through visual hierarchy

**Attention Guidance:**
- Design interfaces that guide user attention effectively
- Avoid cluttered interfaces where elements compete
- Create clear paths through the content
