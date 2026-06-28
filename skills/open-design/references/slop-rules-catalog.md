# Slop Rules Catalogue — Three Detection Layers

The complete design anti-pattern ("slop") catalogue, adapted from
[pbakaus/impeccable](https://github.com/pbakaus/impeccable) (Apache-2.0) into the
agentbox idiom. Impeccable surfaces these through 23 explicit `/impeccable …`
slash commands; here they are a **quality gate reached by inferred intent** — the
agent runs the deterministic layer via `scripts/slop-detect.py` and applies the
remaining two layers by judgment during open-design Phase 6 and design-audit.

Three layers, by *how* a signal is decided:

| Layer | Decided by | Tooling |
|-------|-----------|---------|
| **CLI** | Static regex/heuristic on source | `scripts/slop-detect.py` (no LLM, no network) |
| **Browser** | Computed layout / rendered DOM | `browser` sidecar + judgment (run page, measure) |
| **LLM** | Aesthetic/semantic judgment | The agent, reading the artifact against this catalogue |

Each rule: `id` · layer · category · what it detects · the fix. Categories:
`slop` (generic-AI tell), `color`, `typography`, `animation`, `accessibility`,
`quality`.

---

## Layer 1 — CLI (deterministic, implemented in `slop-detect.py`)

| id | category | Detects | Fix |
|----|----------|---------|-----|
| `overused-font` | slop | Inter / Roboto / Open Sans / Lato / Montserrat / Poppins / Space Grotesk as the primary face | Pair with a distinctive display face; if Inter is mandated, use a decisive weight + `font-feature-settings` |
| `single-font` | slop | One non-generic family across the file — no heading/body contrast | Introduce a second face for display vs body |
| `gradient-text` | slop | `background-clip:text` + transparent fill | Solid `--fg`; reserve gradient for a non-text accent |
| `purple-blue-gradient` | slop | `linear-gradient` containing both a blue and a purple stop | Flat brand colour from `--accent`/`--bg` |
| `bounce-easing` | slop | Overshoot `cubic-bezier` (negative control point) or `bounce`/`elastic`/`back` easing | 150–300ms `ease-out` |
| `side-tab` | slop | Thick (≥3px) one-sided border on a card | Remove the stripe; use a tinted surface or full hairline border |
| `dark-glow` | slop | `text-shadow` with ≥8px blur (neon glow) | Drop the glow unless the thesis is synthwave/Y2K |
| `generic-drop-shadow` | slop | Default `0 1px 3px rgba(0,0,0,…)` | Tint the shadow toward the surface hue; vary elevation |
| `pure-black-white` | color | Pure `#000` / `#fff` | Tint slightly toward the accent |
| `gray-on-color` | color | Gray text colour set on a colored (non-neutral) background | Use a tinted foreground from the same hue family |
| `layout-transition` | animation | `transition` on width/height/top/left/margin | Animate `transform`/`opacity` only |
| `tiny-text` | typography | `font-size < 11px` | ≥11px; ≥16px body on mobile |
| `tight-leading` | typography | unitless `line-height < 1.3` | 1.5–1.75 for body |
| `wide-tracking` | typography | `letter-spacing > 0.15em` | Only for short display, never body |
| `justified-text` | typography | `text-align: justify` | Left-align — avoids whitespace rivers |
| `all-caps-body` | typography | `text-transform: uppercase` (review context) | Caps for short labels only |
| `pill-button` | slop | radius `9999px`/`999px`/`50rem` | Use a brand radius scale unless pills are the thesis |
| `nested-cards` | slop | A `card` class nested inside another `card` (indent heuristic) | Collapse one level — no borders-in-borders |
| `skipped-heading` | accessibility | Heading level jumps (h1→h3) | Keep the outline sequential |
| `everything-centered` | slop | ≥5 center-aligned blocks | Left-align body; centre sparingly |

`slop-detect.py` also recognises inline suppression, mirroring impeccable's
`impeccable-disable`:

```css
/* slop-disable overused-font */
.brand { font-family: Inter; }            /* same-line or block scope */
/* slop-disable-next-line tiny-text */
.fine-print { font-size: 10px; }
```
```html
<!-- slop-disable nested-cards gradient-text -->
```

---

## Layer 2 — Browser (run the page; measure computed values)

Use the `browser` sidecar (`mcp__browser-gpu__*`) to render and measure. These
need layout the static scanner cannot see.

| id | category | Detects | How to check |
|----|----------|---------|--------------|
| `line-length` | typography | Paragraphs exceeding ~75ch measure | Measure rendered text column width / character count |
| `cramped-padding` | typography | Vertical padding too small for a 44px touch target | Read computed box of interactive elements |
| `low-contrast` | color | Text/background contrast below WCAG 4.5:1 | Compute contrast on *rendered* colours (after cascade) |
| `flat-type-hierarchy` | slop | Heading levels too close in computed size/weight | Compare computed `font-size`/`weight` across levels |
| `monotonous-spacing` | slop | Uniform gaps everywhere — no rhythm | Sample computed margins across sections |

---

## Layer 3 — LLM (aesthetic & semantic judgment)

No tool decides these — the agent reads the artifact against the catalogue.
These are the bulk of impeccable's "design wisdom" and the part our methodology
already leant on. Apply during the open-design five-dimensional critique.

| id | category | Detects | Fix |
|----|----------|---------|-----|
| `icon-tile-stack` | slop | Rounded icon tile stacked above every heading | Inline the icon or drop the tile |
| `everything-in-cards` | slop | Every block wrapped in a bordered container | Let content breathe on the page background |
| `identical-card-grids` | slop | Repeated icon/heading/text cards | Asymmetry: one large + supporting, varied sizes |
| `hero-metric-layout` | slop | Big-number + label + supporting-stats cliché | Only if the metric genuinely leads the story |
| `glassmorphism` | slop | Decorative blur/glass with no thesis | Remove unless glass *is* the design thesis |
| `sparkline-decoration` | slop | Tiny charts conveying no real data | Use real data or remove |
| `modal-reflex` | slop | Modal as the default container | Inline flows; reserve modals for interruptions |
| `monospace-as-technical` | slop | Mono face used only to *signal* "developer" | Mono for code/data, not vibe |
| `dark-mode-default` | slop | Dark mode chosen as a safety default | Choose mode from the brand thesis |
| `ai-color-palette` | slop | Incoherent AI-generated scheme | Derive all tones from 6 tokens via `color-mix()` |
| `every-button-primary` | quality | All buttons equal visual weight | One primary per view; secondary/ghost for the rest |
| `redundant-headers` | quality | Intro text restating the heading verbatim | Cut the restatement; add information |
| `mobile-amputation` | quality | Critical features hidden on mobile | Reflow, don't remove |
| `sketchy-svg` | slop | Hand-drawn/"sketchy" filler SVG illustration | Real product imagery or a labelled placeholder |
| `numbered-scaffolding` | slop | Reflex "Step 1/2/3" or numbered sections everywhere | Number only genuine sequences |
| `cream-background` | color | Reflex off-white cream `#FFF…E…`/beige as "warm" | Use a deliberate neutral from the palette |

---

## How this maps to our existing gates

- The **12-signal checklist** in `anti-slop-rules.md` is the fast judgment pass;
  this catalogue is the exhaustive reference behind it.
- The **five-dimensional critique** (`critique-dimensions.md`) is *why* a signal
  matters — most slop is a Philosophy-Consistency or Innovation failure.
- **Persistence**: record confirmed slop fixes and any intentional exceptions
  (the equivalent of impeccable's `ignoreValues`) in RuVector memory
  (`namespace: project-state`, key `design-slop-exceptions`) rather than a flat
  config file — see SKILL.md "Memory" note.
