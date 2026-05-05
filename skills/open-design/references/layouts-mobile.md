# Mobile Screen Archetypes — 6 Layouts

Each archetype renders inside an iPhone 15 Pro device frame. Pick exactly one per screen.

---

## Detection Table

| Brief Language | Archetype |
|---------------|-----------|
| feed, inbox, timeline, list, messages, notifications | A — Feed |
| article, post, item, recipe, song, product detail | B — Detail |
| sign-up, welcome, intro, walkthrough, tour | C — Onboarding |
| profile, account, user page, bio | D — Profile |
| checkout, payment, order, form, settings | E — Checkout |
| timer, map, dashboard widget, single metric | F — Focus |

A mobile screen does **one job**. If the brief combines two, ship one and offer the other as follow-up.

---

## Archetype A — Feed

```html
<main class="content">
  <header class="screen-header">
    <h1 class="screen-title">[FEED TITLE]</h1>
    <button class="icon-btn" aria-label="[ACTION]">
      <svg viewBox="0 0 24 24" width="20" height="20"><!-- icon --></svg>
    </button>
  </header>
  <ul class="feed-list">
    <li class="feed-item">
      <div class="feed-avatar ph-img" style="width:40px;height:40px;border-radius:50%"></div>
      <div class="feed-body">
        <span class="feed-author">[NAME]</span>
        <span class="feed-meta num">[TIME]</span>
        <p class="feed-text">[CONTENT — 1-2 lines]</p>
      </div>
    </li>
    <!-- repeat 4-6 items -->
  </ul>
</main>
<nav class="tabbar">
  <a class="tab tab--active" aria-label="[TAB 1]"><svg><!-- icon --></svg></a>
  <a class="tab" aria-label="[TAB 2]"><svg><!-- icon --></svg></a>
  <a class="tab" aria-label="[TAB 3]"><svg><!-- icon --></svg></a>
  <a class="tab" aria-label="[TAB 4]"><svg><!-- icon --></svg></a>
</nav>
```

---

## Archetype B — Detail

Drop the tab bar for detail screens.

```html
<main class="content">
  <header class="screen-header">
    <button class="icon-btn" aria-label="Back">
      <svg viewBox="0 0 24 24" width="20" height="20"><!-- chevron-left --></svg>
    </button>
    <h1 class="screen-title">[ITEM TITLE]</h1>
    <button class="icon-btn" aria-label="[ACTION]">
      <svg viewBox="0 0 24 24" width="20" height="20"><!-- icon --></svg>
    </button>
  </header>
  <div class="detail-hero ph-img" style="aspect-ratio:16/9"></div>
  <div class="detail-body">
    <h2>[HEADING]</h2>
    <p class="detail-meta num">[META — date, category, author]</p>
    <p>[BODY TEXT — 2-4 lines of real content]</p>
  </div>
  <div class="detail-actions">
    <button class="btn">[PRIMARY ACTION]</button>
    <button class="btn-ghost">[SECONDARY ACTION]</button>
  </div>
</main>
```

---

## Archetype C — Onboarding

Drop the tab bar. Full-bleed, single-focus.

```html
<main class="content onboarding">
  <div class="onboarding-illustration ph-img" style="aspect-ratio:1/1;max-width:240px;margin:0 auto"></div>
  <h1 class="onboarding-title">[HEADLINE — benefit, not feature]</h1>
  <p class="onboarding-body">[DESCRIPTION — 1-2 sentences]</p>
  <div class="onboarding-actions">
    <button class="btn" style="width:100%">[CONTINUE / GET STARTED]</button>
    <button class="btn-ghost" style="width:100%">[SKIP]</button>
  </div>
  <div class="onboarding-dots">
    <span class="dot dot--active"></span>
    <span class="dot"></span>
    <span class="dot"></span>
  </div>
</main>
```

---

## Archetype D — Profile

```html
<main class="content">
  <header class="screen-header">
    <button class="icon-btn" aria-label="Settings">
      <svg viewBox="0 0 24 24" width="20" height="20"><!-- gear --></svg>
    </button>
    <h1 class="screen-title">Profile</h1>
    <button class="icon-btn" aria-label="Edit">
      <svg viewBox="0 0 24 24" width="20" height="20"><!-- pencil --></svg>
    </button>
  </header>
  <div class="profile-header" style="text-align:center">
    <div class="profile-avatar ph-img" style="width:80px;height:80px;border-radius:50%;margin:0 auto"></div>
    <h2 class="profile-name">[DISPLAY NAME]</h2>
    <p class="profile-bio">[BIO — one line]</p>
    <div class="profile-stats" style="display:flex;justify-content:center;gap:24px">
      <div><span class="num">[N]</span><br><small>[LABEL]</small></div>
      <div><span class="num">[N]</span><br><small>[LABEL]</small></div>
      <div><span class="num">[N]</span><br><small>[LABEL]</small></div>
    </div>
  </div>
  <ul class="profile-menu">
    <li><a href="#">[MENU ITEM 1]</a></li>
    <li><a href="#">[MENU ITEM 2]</a></li>
    <li><a href="#">[MENU ITEM 3]</a></li>
  </ul>
</main>
<nav class="tabbar">
  <!-- tabs -->
</nav>
```

---

## Archetype E — Checkout / Form

Drop the tab bar. Linear flow.

```html
<main class="content">
  <header class="screen-header">
    <button class="icon-btn" aria-label="Back">
      <svg viewBox="0 0 24 24" width="20" height="20"><!-- chevron-left --></svg>
    </button>
    <h1 class="screen-title">[STEP TITLE]</h1>
    <span class="num step-indicator">[N] of [TOTAL]</span>
  </header>
  <form class="checkout-form">
    <div class="form-group">
      <label for="field1">[LABEL]</label>
      <input type="text" id="field1" placeholder="[PLACEHOLDER]">
    </div>
    <div class="form-group">
      <label for="field2">[LABEL]</label>
      <input type="text" id="field2" placeholder="[PLACEHOLDER]">
    </div>
    <div class="form-group">
      <label for="field3">[LABEL]</label>
      <select id="field3">
        <option>[OPTION 1]</option>
        <option>[OPTION 2]</option>
      </select>
    </div>
  </form>
  <div class="checkout-footer">
    <div class="checkout-total">
      <span>Total</span>
      <span class="num">[AMOUNT]</span>
    </div>
    <button class="btn" style="width:100%">[CONFIRM ACTION]</button>
  </div>
</main>
```

---

## Archetype F — Focus / Hero Card

Single metric or map dominates. Minimal chrome.

```html
<main class="content focus-screen">
  <header class="screen-header">
    <button class="icon-btn" aria-label="Close">
      <svg viewBox="0 0 24 24" width="20" height="20"><!-- x --></svg>
    </button>
    <h1 class="screen-title">[CONTEXT LABEL]</h1>
  </header>
  <div class="focus-hero">
    <span class="num focus-value" style="font-size:3.5rem">[BIG NUMBER or MAP]</span>
    <span class="focus-unit">[UNIT / LABEL]</span>
  </div>
  <div class="focus-details">
    <div class="focus-stat">
      <span class="num">[VALUE]</span>
      <small>[LABEL]</small>
    </div>
    <div class="focus-stat">
      <span class="num">[VALUE]</span>
      <small>[LABEL]</small>
    </div>
  </div>
  <button class="btn" style="width:100%;margin-top:auto">[ACTION]</button>
</main>
```

---

## Hard Rules (All Archetypes)

- **Phone frame is real.** Dynamic Island, status bar SVGs, home indicator — all from the seed template. Don't rewrite the frame.
- **Single screen, single job.** No multi-tab tours or spliced flows.
- **Tap targets ≥44px.** Every interactive element.
- **Accent budget = 2.** Active tab + primary action button.
- **Numerics in mono** via `.num` class.
- **Display font for headings** via `var(--font-display)`.
- **No external images** — use `.ph-img` placeholders.
- **No horizontal scroll** — content wraps within device width.
