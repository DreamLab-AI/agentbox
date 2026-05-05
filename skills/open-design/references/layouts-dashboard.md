# Dashboard Layouts — Admin / Analytics Patterns

---

## Structure

Every dashboard has three structural zones:

```
┌─────────────────────────────────────────────────┐
│ TOPBAR (sticky, 56-64px height)                 │
├──────────┬──────────────────────────────────────┤
│          │                                      │
│ SIDEBAR  │  MAIN AREA (scrollable)              │
│ 220-260px│                                      │
│ (sticky) │  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐  │
│          │  │ KPI │ │ KPI │ │ KPI │ │ KPI │  │
│          │  └─────┘ └─────┘ └─────┘ └─────┘  │
│          │                                      │
│          │  ┌───────────────┐ ┌────────────┐  │
│          │  │   CHART       │ │   TABLE    │  │
│          │  │               │ │            │  │
│          │  └───────────────┘ └────────────┘  │
│          │                                      │
└──────────┴──────────────────────────────────────┘
```

---

## Topbar

```html
<header class="topbar" data-od-id="topbar">
  <div class="topbar-left">
    <button class="icon-btn sidebar-toggle" aria-label="Toggle sidebar">
      <svg viewBox="0 0 24 24" width="20" height="20"><!-- menu --></svg>
    </button>
    <h1 class="topbar-title">[DASHBOARD NAME]</h1>
  </div>
  <div class="topbar-center">
    <div class="search-box">
      <svg viewBox="0 0 24 24" width="16" height="16"><!-- search --></svg>
      <input type="search" placeholder="Search...">
    </div>
  </div>
  <div class="topbar-right">
    <button class="icon-btn" aria-label="Notifications">
      <svg viewBox="0 0 24 24" width="20" height="20"><!-- bell --></svg>
    </button>
    <div class="avatar ph-img" style="width:32px;height:32px;border-radius:50%"></div>
  </div>
</header>
```

---

## Sidebar

```html
<aside class="sidebar" data-od-id="sidebar">
  <div class="sidebar-brand">
    <svg class="sidebar-logo" viewBox="0 0 24 24" width="24" height="24"><!-- logo --></svg>
    <span class="sidebar-brand-name">[PRODUCT]</span>
  </div>
  <nav class="sidebar-nav">
    <a class="nav-item nav-item--active" href="#">
      <svg viewBox="0 0 24 24" width="18" height="18"><!-- icon --></svg>
      <span>[NAV ITEM 1 — active]</span>
    </a>
    <a class="nav-item" href="#">
      <svg viewBox="0 0 24 24" width="18" height="18"><!-- icon --></svg>
      <span>[NAV ITEM 2]</span>
    </a>
    <a class="nav-item" href="#">
      <svg viewBox="0 0 24 24" width="18" height="18"><!-- icon --></svg>
      <span>[NAV ITEM 3]</span>
    </a>
    <a class="nav-item" href="#">
      <svg viewBox="0 0 24 24" width="18" height="18"><!-- icon --></svg>
      <span>[NAV ITEM 4]</span>
    </a>
  </nav>
  <div class="sidebar-footer">
    <a class="nav-item" href="#">
      <svg viewBox="0 0 24 24" width="18" height="18"><!-- settings --></svg>
      <span>Settings</span>
    </a>
  </div>
</aside>
```

---

## KPI Cards (Grid of 3-4)

```html
<section class="kpi-grid" data-od-id="kpi">
  <div class="kpi-card">
    <span class="kpi-label">[METRIC NAME]</span>
    <span class="num kpi-value">[VALUE]</span>
    <span class="kpi-change kpi-change--up">
      <svg viewBox="0 0 24 24" width="12" height="12"><!-- arrow-up --></svg>
      <span class="num">[+N%]</span>
      <span>vs last period</span>
    </span>
  </div>
  <div class="kpi-card">
    <span class="kpi-label">[METRIC NAME]</span>
    <span class="num kpi-value">[VALUE]</span>
    <span class="kpi-change kpi-change--down">
      <svg viewBox="0 0 24 24" width="12" height="12"><!-- arrow-down --></svg>
      <span class="num">[-N%]</span>
      <span>vs last period</span>
    </span>
  </div>
  <div class="kpi-card">
    <span class="kpi-label">[METRIC NAME]</span>
    <span class="num kpi-value">[VALUE]</span>
    <span class="kpi-change kpi-change--neutral">
      <span class="num">[0%]</span>
      <span>vs last period</span>
    </span>
  </div>
  <div class="kpi-card">
    <span class="kpi-label">[METRIC NAME]</span>
    <span class="num kpi-value">[VALUE]</span>
    <span class="kpi-change kpi-change--up">
      <svg viewBox="0 0 24 24" width="12" height="12"><!-- arrow-up --></svg>
      <span class="num">[+N%]</span>
      <span>vs last period</span>
    </span>
  </div>
</section>
```

---

## Chart Section (Inline SVG)

```html
<section class="chart-section" data-od-id="chart-main">
  <div class="chart-card">
    <div class="chart-header">
      <h3>[CHART TITLE]</h3>
      <div class="chart-controls">
        <button class="chip chip--active">7d</button>
        <button class="chip">30d</button>
        <button class="chip">90d</button>
      </div>
    </div>
    <div class="chart-body">
      <svg viewBox="0 0 600 200" class="chart-svg" preserveAspectRatio="none">
        <!-- line chart path using var(--accent) -->
        <path d="[CHART PATH DATA]" fill="none" stroke="var(--accent)" stroke-width="2"/>
        <!-- area fill -->
        <path d="[AREA PATH DATA]" fill="var(--accent)" opacity="0.08"/>
        <!-- grid lines -->
        <line x1="0" y1="50" x2="600" y2="50" stroke="var(--border)" stroke-dasharray="4"/>
        <line x1="0" y1="100" x2="600" y2="100" stroke="var(--border)" stroke-dasharray="4"/>
        <line x1="0" y1="150" x2="600" y2="150" stroke="var(--border)" stroke-dasharray="4"/>
      </svg>
    </div>
    <div class="chart-legend">
      <span class="legend-item"><span class="legend-dot" style="background:var(--accent)"></span>[SERIES 1]</span>
    </div>
  </div>
</section>
```

---

## Data Table

```html
<section class="table-section" data-od-id="table">
  <div class="table-card">
    <div class="table-header">
      <h3>[TABLE TITLE]</h3>
      <button class="btn-ghost btn--sm">View all</button>
    </div>
    <table class="data-table">
      <thead>
        <tr>
          <th>[COL 1]</th>
          <th>[COL 2]</th>
          <th class="num">[COL 3 — numeric]</th>
          <th>[COL 4 — status]</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>[VALUE]</td>
          <td>[VALUE]</td>
          <td class="num">[NUMBER]</td>
          <td><span class="badge badge--success">[STATUS]</span></td>
        </tr>
        <!-- repeat 4-8 rows -->
      </tbody>
    </table>
  </div>
</section>
```

---

## Hard Rules (Dashboards)

- **Sidebar and topbar are sticky** — main area scrolls independently
- **All numbers use `.num`** (monospace tabular figures)
- **Charts use inline SVG only** — no external charting libraries
- **KPI changes show direction** — up (green), down (red), neutral (muted)
- **Classify dashboard purpose first** — sales, traffic, usage, ops — then generate specific metric names (not generic "Total Users")
- **Maximum information density** — dashboards are not landing pages; use smaller type and tighter spacing
- **Border-based separation** — prefer 1px borders over shadows for panel delineation
