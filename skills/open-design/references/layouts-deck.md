# Presentation / Deck Layouts

HTML-based slide decks. Each slide is a `<section>` at viewport height.

---

## Structure

```html
<div class="deck">
  <section class="slide" data-od-id="slide-1">...</section>
  <section class="slide" data-od-id="slide-2">...</section>
  <!-- one section per slide -->
</div>
```

**Core CSS for decks:**
```css
.deck { scroll-snap-type: y mandatory; overflow-y: scroll; height: 100vh; }
.slide {
  scroll-snap-align: start;
  min-height: 100vh;
  display: flex; align-items: center; justify-content: center;
  padding: 64px;
}
```

---

## Slide 1 — Title

```html
<section class="slide slide--title" data-od-id="title">
  <div class="slide-content" style="text-align:center">
    <p class="eyebrow">[COMPANY / DATE]</p>
    <h1>[DECK TITLE — under 8 words]</h1>
    <p class="lead">[SUBTITLE — one line context]</p>
  </div>
</section>
```

---

## Slide 2 — Agenda / Overview

```html
<section class="slide" data-od-id="agenda">
  <div class="slide-content">
    <h2>Agenda</h2>
    <ol class="agenda-list">
      <li><span class="num">01</span> [TOPIC]</li>
      <li><span class="num">02</span> [TOPIC]</li>
      <li><span class="num">03</span> [TOPIC]</li>
      <li><span class="num">04</span> [TOPIC]</li>
    </ol>
  </div>
</section>
```

---

## Slide 3 — Statement (Big Idea)

```html
<section class="slide slide--statement" data-od-id="statement">
  <div class="slide-content" style="text-align:center;max-width:800px">
    <h2 style="font-size:2.5rem">[ONE POWERFUL STATEMENT — under 12 words]</h2>
  </div>
</section>
```

---

## Slide 4 — Content (Text + Visual)

```html
<section class="slide" data-od-id="content-1">
  <div class="slide-content grid-2" style="align-items:center">
    <div>
      <h2>[SECTION HEADING]</h2>
      <p>[KEY POINT — 2-3 sentences max]</p>
      <ul>
        <li>[BULLET 1]</li>
        <li>[BULLET 2]</li>
        <li>[BULLET 3]</li>
      </ul>
    </div>
    <div class="ph-img" style="aspect-ratio:4/3"></div>
  </div>
</section>
```

---

## Slide 5 — Data / Metrics

```html
<section class="slide" data-od-id="metrics">
  <div class="slide-content" style="text-align:center">
    <h2>[SECTION HEADING]</h2>
    <div class="grid-3" style="margin-top:48px">
      <div>
        <span class="num" style="font-size:3rem;font-weight:600">[NUMBER]</span>
        <p class="lead">[WHAT IT MEASURES]</p>
      </div>
      <div>
        <span class="num" style="font-size:3rem;font-weight:600">[NUMBER]</span>
        <p class="lead">[WHAT IT MEASURES]</p>
      </div>
      <div>
        <span class="num" style="font-size:3rem;font-weight:600">[NUMBER]</span>
        <p class="lead">[WHAT IT MEASURES]</p>
      </div>
    </div>
  </div>
</section>
```

---

## Slide 6 — Quote / Testimonial

```html
<section class="slide slide--quote" data-od-id="quote">
  <div class="slide-content" style="text-align:center;max-width:700px">
    <blockquote style="font-size:1.5rem;font-style:italic">
      "[QUOTE — specific, under 30 words]"
    </blockquote>
    <cite style="margin-top:1rem;display:block;color:var(--muted)">— [NAME], [ROLE]</cite>
  </div>
</section>
```

---

## Slide 7 — Summary / Close

```html
<section class="slide slide--close" data-od-id="close">
  <div class="slide-content" style="text-align:center">
    <h2>[CLOSING STATEMENT]</h2>
    <p class="lead">[NEXT STEP or CTA]</p>
    <div style="margin-top:2rem">
      <p class="num" style="font-size:0.875rem;color:var(--muted)">[CONTACT / URL]</p>
    </div>
  </div>
</section>
```

---

## Hard Rules (Decks)

- **One idea per slide.** If you need a bullet list, keep it to 3-4 items max.
- **No walls of text.** Max 40 words per slide (excluding the title slide).
- **Display font at 2rem+.** Slides are viewed at distance — minimum heading size is 2rem.
- **Scroll-snap navigation.** Each slide snaps to viewport height.
- **Accent once per slide.** One highlighted element — a number, a key word, or a CTA.
- **No external dependencies.** Self-contained HTML, inline CSS, no JavaScript frameworks.
