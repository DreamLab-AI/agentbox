# Web Section Layouts — Paste-Ready Skeletons

Copy these section blocks into `<main>`. Replace `[BRACKETED]` content with real copy from the brief.

---

## Class Inventory

These classes MUST be defined in `<style>`. The seed template provides them:

```
.container    — max-width + centering
.lead         — max-width: 60ch, muted color
.eyebrow      — mono, uppercase, letterspaced, accent color
.btn          — primary button
.btn-ghost    — outlined/ghost button
.num          — monospace tabular figures
.ph-img       — placeholder image (aspect-ratio, bg-color, border-radius)
.grid-2       — 2-column grid
.grid-3       — 3-column grid
.grid-4       — 4-column grid
```

---

## Layout 1 — Hero (Left-Aligned)

```html
<section data-od-id="hero" class="hero">
  <div class="container">
    <p class="eyebrow">[EYEBROW — 2-3 words, category or tagline]</p>
    <h1>[HEADLINE — under 10 words, specific benefit]</h1>
    <p class="lead">[SUBHEAD — 1-2 sentences, expand on the benefit]</p>
    <div class="hero-actions">
      <a href="#" class="btn">[PRIMARY CTA — outcome verb]</a>
      <a href="#" class="btn-ghost">[SECONDARY CTA]</a>
    </div>
  </div>
</section>
```

---

## Layout 2 — Hero (Centered)

```html
<section data-od-id="hero-center" class="hero hero--center">
  <div class="container" style="text-align:center">
    <p class="eyebrow">[EYEBROW]</p>
    <h1>[HEADLINE]</h1>
    <p class="lead" style="margin-inline:auto">[SUBHEAD]</p>
    <div class="hero-actions" style="justify-content:center">
      <a href="#" class="btn">[PRIMARY CTA]</a>
    </div>
  </div>
</section>
```

---

## Layout 3 — Feature Grid (3-Column)

```html
<section data-od-id="features" class="features">
  <div class="container">
    <h2>[SECTION HEADING — what this group demonstrates]</h2>
    <div class="grid-3">
      <div class="feature-card">
        <svg class="feature-icon" viewBox="0 0 24 24" width="32" height="32">
          <!-- inline SVG monoline icon -->
        </svg>
        <h3>[FEATURE TITLE — 3-5 words]</h3>
        <p>[FEATURE DESCRIPTION — 1-2 sentences, specific]</p>
      </div>
      <div class="feature-card">
        <svg class="feature-icon" viewBox="0 0 24 24" width="32" height="32">
          <!-- icon -->
        </svg>
        <h3>[FEATURE TITLE]</h3>
        <p>[FEATURE DESCRIPTION]</p>
      </div>
      <div class="feature-card">
        <svg class="feature-icon" viewBox="0 0 24 24" width="32" height="32">
          <!-- icon -->
        </svg>
        <h3>[FEATURE TITLE]</h3>
        <p>[FEATURE DESCRIPTION]</p>
      </div>
    </div>
  </div>
</section>
```

---

## Layout 4 — Stats Row

```html
<section data-od-id="stats" class="stats">
  <div class="container">
    <div class="grid-3" style="text-align:center">
      <div class="stat">
        <span class="num stat-value">[NUMBER]</span>
        <span class="stat-label">[LABEL — what it measures]</span>
      </div>
      <div class="stat">
        <span class="num stat-value">[NUMBER]</span>
        <span class="stat-label">[LABEL]</span>
      </div>
      <div class="stat">
        <span class="num stat-value">[NUMBER]</span>
        <span class="stat-label">[LABEL]</span>
      </div>
    </div>
  </div>
</section>
```

**Rule:** Numbers must come from the brief or be explicitly labeled as placeholder. No invented metrics.

---

## Layout 5 — Testimonial / Quote

```html
<section data-od-id="quote" class="quote-section">
  <div class="container">
    <blockquote>
      <p>[QUOTE — real words, specific outcome, under 40 words]</p>
      <cite>[NAME], [ROLE] at [COMPANY]</cite>
    </blockquote>
  </div>
</section>
```

---

## Layout 6 — CTA Band

```html
<section data-od-id="cta" class="cta-band">
  <div class="container" style="text-align:center">
    <h2>[CTA HEADLINE — action-oriented, under 8 words]</h2>
    <p class="lead" style="margin-inline:auto">[CTA SUBTEXT — one sentence]</p>
    <a href="#" class="btn">[CTA BUTTON — outcome verb]</a>
  </div>
</section>
```

---

## Layout 7 — Log / List

```html
<section data-od-id="log-list" class="log-list">
  <div class="container">
    <h2>[SECTION HEADING]</h2>
    <ul class="log">
      <li>
        <span class="log-meta num">[DATE or CATEGORY]</span>
        <a href="#">[ITEM TITLE]</a>
        <p>[ITEM DESCRIPTION — one sentence]</p>
      </li>
      <li>
        <span class="log-meta num">[DATE or CATEGORY]</span>
        <a href="#">[ITEM TITLE]</a>
        <p>[ITEM DESCRIPTION]</p>
      </li>
      <!-- repeat -->
    </ul>
  </div>
</section>
```

---

## Layout 8 — Comparison / Pricing Table

```html
<section data-od-id="pricing" class="pricing">
  <div class="container">
    <h2 style="text-align:center">[SECTION HEADING]</h2>
    <div class="grid-3">
      <div class="pricing-card">
        <h3>[TIER NAME]</h3>
        <p class="num pricing-amount">[PRICE]<span class="pricing-period">/mo</span></p>
        <ul class="pricing-features">
          <li>[FEATURE 1]</li>
          <li>[FEATURE 2]</li>
          <li>[FEATURE 3]</li>
        </ul>
        <a href="#" class="btn-ghost">[CTA]</a>
      </div>
      <div class="pricing-card pricing-card--featured">
        <h3>[TIER NAME]</h3>
        <p class="num pricing-amount">[PRICE]<span class="pricing-period">/mo</span></p>
        <ul class="pricing-features">
          <li>[FEATURE 1]</li>
          <li>[FEATURE 2]</li>
          <li>[FEATURE 3]</li>
          <li>[FEATURE 4]</li>
        </ul>
        <a href="#" class="btn">[CTA]</a>
      </div>
      <div class="pricing-card">
        <h3>[TIER NAME]</h3>
        <p class="num pricing-amount">[PRICE]<span class="pricing-period">/mo</span></p>
        <ul class="pricing-features">
          <li>[FEATURE 1]</li>
          <li>[FEATURE 2]</li>
          <li>[FEATURE 3]</li>
          <li>[FEATURE 4]</li>
          <li>[FEATURE 5]</li>
        </ul>
        <a href="#" class="btn-ghost">[CTA]</a>
      </div>
    </div>
  </div>
</section>
```

---

## Default Page Rhythms

| Page Kind | Recommended Section Order |
|-----------|--------------------------|
| Landing | 1 hero → 3 features → 4 stats → 5 quote → 6 cta |
| Marketing/Editorial | 2 hero-center → 7 log → 6 cta |
| Pricing | 2 hero-center → 8 pricing → 5 quote → 6 cta |
| Docs Index | 2 hero-center → 7 log (doc sections) → 6 cta |
| Product | 1 hero → 3 features → 4 stats → 3 features (detailed) → 5 quote → 6 cta |

**Rule:** Never repeat the same layout consecutively. Alternate section types for visual rhythm.
