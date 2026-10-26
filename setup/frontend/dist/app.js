// Agentbox pre-boot setup wizard
//
// The browser never parses or writes TOML. The server parses agentbox.toml to
// JSON for display and applies each change as a targeted edit with a
// comment-preserving editor (POST /api/config/edit), so comments, ordering and
// untouched values survive byte for byte. Section labels, groups and apply
// classes come from schema/agentbox.toml.ui.json and agentbox.toml.apply.json;
// field descriptions come from the JSON schema. Nothing is hard-coded here.
(function () {
  'use strict';

  const state = {
    toml: '',          // current document text (server-edited)
    parsed: {},        // server parse of `toml`
    schema: {},
    ui: { groups: [], sections: {} },
    apply: { classes: {}, gates: {} },
    seeded: false,
    pending: new Map(),   // path-key -> { path, value } waiting to be sent
    changes: new Map(),   // path-key -> { path, value } sent and not yet saved
    dirty: false,
    active: null,
    queue: Promise.resolve(),
  };

  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => [...(ctx || document).querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const keyOf = (path) => JSON.stringify(path);
  const dotted = (path) => path.filter((s) => typeof s === 'string').join('.');

  async function api(path, opts = {}) {
    const res = await fetch(`/api${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      const e = new Error(text || `${res.status}`);
      e.http = res.status;
      throw e;
    }
    const ct = res.headers.get('content-type') || '';
    return ct.includes('json') ? res.json() : null;
  }

  function toast(msg, kind = 'info') {
    let box = $('.toast-container');
    if (!box) {
      box = document.createElement('div');
      box.className = 'toast-container';
      document.body.appendChild(box);
    }
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => t.remove(), kind === 'error' ? 8000 : 3500);
  }

  function setStatus(kind, label) {
    const s = $('#status');
    if (s) { s.className = `status-badge ${kind}`; s.textContent = label; }
    const c = $('#connection');
    if (c) {
      c.classList.toggle('connected', kind === 'connected');
      const l = $('.conn-label', c);
      if (l) l.textContent = kind === 'connected' ? 'server' : 'offline';
    }
  }

  function updateFooter() {
    const n = state.changes.size + state.pending.size;
    const el = $('#change-count');
    if (el) el.textContent = n === 0 ? 'No unsaved changes' : `${n} unsaved change${n === 1 ? '' : 's'}`;
    state.dirty = n > 0;
  }

  // ─── Schema helpers ──────────────────────────────────────────

  function schemaAt(path) {
    let n = state.schema;
    for (const seg of path) {
      if (typeof seg === 'number') { n = n?.items; continue; }
      n = n?.properties?.[seg]
        ?? (n?.additionalProperties && typeof n.additionalProperties === 'object' ? n.additionalProperties : undefined);
      if (!n) return undefined;
    }
    return n;
  }

  function dataAt(path) {
    let v = state.parsed;
    for (const seg of path) { v = v?.[seg]; if (v === undefined) return undefined; }
    return v;
  }

  const isTable = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  function applyFor(path) {
    return state.apply.gates?.[dotted(path)];
  }

  function badge(path) {
    const g = applyFor(path);
    if (!g) return '';
    const label = { live: 'Live', boot: 'On restart', rebuild: 'Needs rebuild' }[g.class] || g.class;
    const tip = state.apply.classes?.[g.class] || '';
    return `<span class="apply-badge apply-${esc(g.class)}" title="${esc(tip)}">${esc(label)}</span>`;
  }

  function more(path) {
    const g = applyFor(path);
    if (!g?.summary) return '';
    return `<details class="form-more"><summary>About ${esc(g.name)}</summary><p>${esc(g.summary)}</p></details>`;
  }

  // ─── Rendering ───────────────────────────────────────────────

  function render() {
    renderLegend();
    const nav = $('#section-nav');
    const container = $('#sections-container');
    nav.innerHTML = '';
    container.innerHTML = '';

    const topKeys = new Set(Object.keys(state.schema.properties || {}));
    for (const k of Object.keys(state.parsed)) topKeys.add(k);

    const byGroup = new Map(state.ui.groups.map((g) => [g.id, []]));
    const other = [];
    for (const k of topKeys) {
      const meta = state.ui.sections[k];
      if (meta && byGroup.has(meta.group)) byGroup.get(meta.group).push(k);
      else other.push(k);
    }
    const groups = state.ui.groups.map((g) => ({ ...g, keys: byGroup.get(g.id) }));
    if (other.length) groups.push({ id: 'other', label: 'Other', blurb: 'Sections without a label in the UI metadata.', keys: other });

    for (const g of groups) {
      if (!g.keys.length) continue;
      const li = document.createElement('li');
      li.className = 'nav-group';
      li.innerHTML = `<div class="nav-group-label">${esc(g.label)}</div>`;
      nav.appendChild(li);

      const head = document.createElement('div');
      head.className = 'group-header';
      head.id = `group-${g.id}`;
      head.innerHTML = `<h2>${esc(g.label)}</h2><p>${esc(g.blurb)}</p>`;
      container.appendChild(head);

      for (const key of g.keys) {
        const meta = state.ui.sections[key] || { label: key };
        const node = state.schema.properties?.[key] || {};
        const data = state.parsed[key];
        const nav_li = document.createElement('li');
        nav_li.innerHTML = `<a href="#section-${esc(key)}" data-section="${esc(key)}">${esc(meta.label)}</a>`;
        nav.appendChild(nav_li);

        const sec = document.createElement('section');
        sec.className = 'section-card';
        sec.id = `section-${key}`;
        sec.dataset.section = key;
        sec.innerHTML = `
          <div class="section-header">
            <div>
              <h3>${esc(meta.label)} ${badge([key])} <code class="section-key">[${esc(key)}]</code></h3>
              <p class="section-desc">${esc(node.description || '')}</p>
              ${more([key])}
            </div>
          </div>
          <div class="section-body">${renderBody([key], node, data)}</div>`;
        container.appendChild(sec);
      }
    }

    $$('#section-nav a').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById(a.getAttribute('href').slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('#sidebar')?.classList.remove('open');
    }));

    if (state.observer) state.observer.disconnect();
    // Track every card crossing the upper part of the viewport and highlight
    // the one the reader is in; tall cards never reach a visible-ratio threshold.
    const visible = new Set();
    state.observer = new IntersectionObserver((entries) => {
      for (const e of entries) (e.isIntersecting ? visible.add(e.target) : visible.delete(e.target));
      // The last visible card whose top edge has reached the upper band.
      const band = window.innerHeight * 0.4;
      const cards = $$('.section-card').filter((c) => visible.has(c));
      const cur = cards.filter((c) => c.getBoundingClientRect().top <= band).pop() || cards[0];
      if (cur) setActiveNav(cur.dataset.section);
    }, { threshold: 0, rootMargin: '-80px 0px -60% 0px' });
    $$('.section-card').forEach((s) => state.observer.observe(s));
    applyFilter();
  }

  function renderLegend() {
    const el = $('#apply-legend');
    if (!el) return;
    const c = state.apply.classes || {};
    el.innerHTML = ['live', 'boot', 'rebuild'].filter((k) => c[k]).map((k) => {
      const label = { live: 'Live', boot: 'On restart', rebuild: 'Needs rebuild' }[k];
      return `<div><span class="apply-badge apply-${k}">${label}</span> <span>${esc(c[k])}</span></div>`;
    }).join('');
    $('#seed-notice').style.display = state.seeded ? '' : 'none';
  }

  function renderBody(path, node, data) {
    const props = node?.properties || {};
    const keys = [...Object.keys(props)];
    if (isTable(data)) for (const k of Object.keys(data)) if (!keys.includes(k)) keys.push(k);
    if (!keys.length) return '<p class="form-hint">Nothing to configure here.</p>';
    return keys.map((k) => renderField([...path, k], props[k], data?.[k])).join('');
  }

  function titleOf(entry, i) {
    if (isTable(entry)) for (const k of ['name', 'id', 'prefix', 'package', 'path']) if (typeof entry[k] === 'string') return entry[k];
    return `#${i + 1}`;
  }

  function renderField(path, node, value) {
    const key = path[path.length - 1];
    node = node || {};
    const desc = node.description ? `<div class="form-hint">${esc(node.description)}</div>` : '';

    // Array of tables, e.g. [[plugins.packages]]: one collapsible entry each.
    if (Array.isArray(value) && value.length && value.every(isTable)) {
      const itemNode = node.items || {};
      return `<div class="subsection open">
        <button class="subsection-toggle" type="button"><span class="chevron">▸</span> ${esc(key)} <span class="count">${value.length} entries</span> ${badge(path)}</button>
        <div class="subsection-body">${desc}
          ${value.map((entry, i) => `<div class="subsection entry">
            <button class="subsection-toggle" type="button"><span class="chevron">▸</span> ${esc(titleOf(entry, i))}</button>
            <div class="subsection-body">${renderBody([...path, i], itemNode, entry)}</div>
          </div>`).join('')}
        </div></div>`;
    }

    // Nested table.
    if (isTable(value) || (value === undefined && node.type === 'object' && node.properties)) {
      const sub = isTable(value) ? value : {};
      const open = path.length <= 2 ? ' open' : '';
      return `<div class="subsection${open}">
        <button class="subsection-toggle" type="button"><span class="chevron">▸</span> ${esc(key)} ${badge(path)}</button>
        <div class="subsection-body">${desc}${more(path)}${renderBody(path, node, sub)}</div>
      </div>`;
    }

    const id = `f-${path.join('-').replace(/[^\w-]/g, '_')}`;
    const da = `data-path='${esc(keyOf(path))}'`;
    const effective = value !== undefined ? value : node.default;
    const unset = value === undefined ? '<span class="unset" title="Not set in the file; the default applies until you change it">default</span>' : '';
    const head = `<label class="form-label" for="${id}"><code>${esc(key)}</code> ${badge(path)} ${unset}</label>${desc}${more(path)}`;
    return `<div class="form-group" data-search="${esc((dotted(path) + ' ' + (node.description || '')).toLowerCase())}">${head}${renderInput(id, da, node, effective, value)}</div>`;
  }

  function renderInput(id, da, node, v, actual) {
    const type = typeof actual === 'boolean' || node.type === 'boolean' ? 'boolean' : null;
    if (node.enum) {
      const opts = node.enum.map((o) => `<option value="${esc(o)}" ${v === o ? 'selected' : ''}>${esc(o)}</option>`).join('');
      const blank = v === undefined ? '<option value="" selected disabled>(not set)</option>' : '';
      return `<select id="${id}" ${da} data-kind="string">${blank}${opts}</select>`;
    }
    if (type === 'boolean') {
      return `<div class="toggle-wrap"><label class="toggle">
        <input type="checkbox" id="${id}" ${v ? 'checked' : ''} ${da} data-kind="boolean">
        <span class="toggle-track"><span class="toggle-thumb"></span></span></label>
        <span class="toggle-state">${v ? 'Enabled' : 'Disabled'}</span></div>`;
    }
    if (typeof actual === 'number' || node.type === 'integer' || node.type === 'number') {
      const int = Number.isInteger(actual) || node.type === 'integer';
      const lim = `${node.minimum != null ? ` min="${node.minimum}"` : ''}${node.maximum != null ? ` max="${node.maximum}"` : ''}`;
      return `<input type="number" id="${id}" value="${v ?? ''}" step="${int ? 1 : 'any'}"${lim} ${da} data-kind="${int ? 'integer' : 'float'}">`;
    }
    if (Array.isArray(actual) || node.type === 'array') {
      const items = Array.isArray(v) ? v : [];
      const numeric = items.length ? items.every((x) => typeof x === 'number') : node.items?.type === 'integer' || node.items?.type === 'number';
      const text = items.join(', ');
      return `<input type="text" id="${id}" value="${esc(text)}" placeholder="comma-separated" ${da} data-kind="${numeric ? 'numlist' : 'list'}">`;
    }
    const ph = node.examples?.length ? ` placeholder="${esc(node.examples[0])}"` : '';
    const s = v === undefined ? '' : String(v);
    if (s.length > 90) return `<textarea id="${id}" rows="3" ${da} data-kind="string"${ph}>${esc(s)}</textarea>`;
    return `<input type="text" id="${id}" value="${esc(s)}"${ph} ${da} data-kind="string">`;
  }

  // ─── Editing ─────────────────────────────────────────────────

  function readValue(el) {
    switch (el.dataset.kind) {
      case 'boolean': return el.checked;
      // The server coerces to the key's existing TOML type (integer or float).
      case 'integer':
      case 'float': return el.value === '' ? undefined : Number(el.value);
      case 'list':
        return el.value.split(',').map((s) => s.trim()).filter(Boolean);
      case 'numlist':
        return el.value.split(',').map((s) => s.trim()).filter(Boolean).map(Number);
      default: return el.value;
    }
  }

  function onChange(e) {
    const el = e.target;
    if (!el.dataset?.path) return;
    const path = JSON.parse(el.dataset.path);
    const value = readValue(el);
    if (el.type === 'checkbox') {
      const lbl = el.closest('.toggle-wrap')?.querySelector('.toggle-state');
      if (lbl) lbl.textContent = value ? 'Enabled' : 'Disabled';
    }
    // TOML has no null: a cleared number field means "leave as it is".
    if (value === undefined || (typeof value === 'number' && Number.isNaN(value))) return;
    state.pending.set(keyOf(path), { path, value });
    updateFooter();
    flushSoon();
  }

  let flushTimer;
  function flushSoon() {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => { flush().catch(() => {}); }, 400);
  }

  /** Send pending edits to the server, one request at a time, last write wins. */
  function flush() {
    clearTimeout(flushTimer);
    // A failed batch must not poison the chain for later edits and the save.
    const run = state.queue.catch(() => {}).then(async () => {
      if (!state.pending.size) return;
      const batch = [...state.pending.values()];
      state.pending.clear();
      try {
        const res = await api('/config/edit', { method: 'POST', body: JSON.stringify({ toml_content: state.toml, edits: batch }) });
        state.toml = res.toml_content;
        state.parsed = res.parsed;
        for (const b of batch) state.changes.set(keyOf(b.path), b);
        $$('.form-group.invalid').forEach((g) => g.classList.remove('invalid'));
      } catch (err) {
        for (const b of batch) {
          const el = document.querySelector(`[data-path='${keyOf(b.path).replace(/'/g, '&#39;')}']`);
          el?.closest('.form-group')?.classList.add('invalid');
        }
        toast(`Edit rejected: ${err.message}`, 'error');
        throw err;
      } finally {
        updateFooter();
      }
    });
    state.queue = run;
    return run;
  }

  // ─── Navigation and filter ───────────────────────────────────

  function setActiveNav(key) {
    if (state.active === key) return;
    state.active = key;
    $$('#section-nav li').forEach((li) => li.classList.toggle('active', li.querySelector('a')?.dataset.section === key));
  }

  function applyFilter() {
    const q = ($('#filter')?.value || '').trim().toLowerCase();
    $$('.form-group').forEach((g) => { g.style.display = !q || g.dataset.search.includes(q) ? '' : 'none'; });
    $$('.section-card').forEach((s) => {
      const any = !q || $$('.form-group', s).some((g) => g.style.display !== 'none') || s.dataset.section.includes(q);
      s.style.display = any ? '' : 'none';
      if (q) $$('.subsection', s).forEach((x) => x.classList.add('open'));
    });
    $$('.group-header').forEach((h) => {
      let n = h.nextElementSibling, any = !q;
      while (n && !n.classList.contains('group-header')) { if (n.style.display !== 'none') any = true; n = n.nextElementSibling; }
      h.style.display = any ? '' : 'none';
    });
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.subsection-toggle');
    if (btn) btn.closest('.subsection')?.classList.toggle('open');
  });

  // ─── Footer actions ──────────────────────────────────────────

  async function save(exit) {
    const btn = exit ? $('#btn-save-exit') : $('#btn-save');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      await flush().catch(() => {}); // a rejected edit was already reported; save the rest
      await api('/config', { method: 'POST', body: JSON.stringify({ toml_content: state.toml }) });
      state.changes.clear();
      updateFooter();
      setStatus('connected', 'saved');
      btn.textContent = '✓ Saved';
      if (exit) {
        setTimeout(async () => {
          try { await api('/shutdown', { method: 'POST' }); } catch { /* server already gone */ }
          window.close();
        }, 400);
      } else {
        setTimeout(() => { btn.textContent = label; btn.disabled = false; }, 1200);
      }
    } catch (err) {
      setStatus('error', 'error');
      btn.textContent = label;
      btn.disabled = false;
      toast(`Save failed: ${err.message}`, 'error');
    }
  }

  async function quit() {
    if (state.dirty && !confirm('Unsaved changes will be lost. Quit anyway?')) return;
    try { await api('/shutdown', { method: 'POST' }); } catch { /* ignore */ }
    window.close();
  }

  async function openRaw() {
    try { await flush(); } catch { /* shown already */ }
    $('#raw-toml').value = state.toml;
    $('#raw-modal').showModal();
  }

  async function applyRaw() {
    const text = $('#raw-toml').value;
    try {
      const res = await api('/config/edit', { method: 'POST', body: JSON.stringify({ toml_content: text, edits: [] }) });
      if (text !== state.toml) state.changes.set('raw', { path: ['(raw editor)'], value: null });
      state.toml = res.toml_content;
      state.parsed = res.parsed;
      updateFooter();
      render();
      $('#raw-modal').close();
    } catch (err) {
      toast(`Invalid TOML: ${err.message}`, 'error');
    }
  }

  // ─── Init ────────────────────────────────────────────────────

  async function load() {
    try {
      const data = await api('/config');
      state.toml = data.toml_content;
      state.parsed = data.parsed;
      state.schema = data.schema || {};
      state.ui = data.ui || state.ui;
      state.apply = data.apply || state.apply;
      state.seeded = !!data.seeded;
    } catch (err) {
      $('#loading').style.display = 'none';
      if (err.http) {
        // The server answered but could not serve the file (e.g. invalid TOML).
        $('#load-error-msg').textContent = err.message;
        $('#load-error').style.display = '';
      } else {
        $('#no-server').style.display = '';
        $('#no-server-reason').textContent = err.message;
      }
      setStatus('error', err.http ? 'error' : 'no server');
      return;
    }
    render();
    setStatus('connected', 'connected');
    updateFooter();
    $('#loading').style.display = 'none';
    $('#editor').style.display = '';
  }

  function init() {
    $('#btn-save')?.addEventListener('click', () => save(false));
    $('#btn-save-exit')?.addEventListener('click', () => save(true));
    $('#btn-cancel')?.addEventListener('click', quit);
    $('#btn-raw')?.addEventListener('click', openRaw);
    $('#raw-apply')?.addEventListener('click', applyRaw);
    $('#raw-cancel')?.addEventListener('click', () => $('#raw-modal').close());
    $('#filter')?.addEventListener('input', applyFilter);
    $('#menu-toggle')?.addEventListener('click', () => $('#sidebar').classList.toggle('open'));
    $('#raw-modal')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
    const container = $('#sections-container');
    container.addEventListener('change', onChange);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && $('#raw-modal')?.open) $('#raw-modal').close();
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(false); }
    });
    window.addEventListener('beforeunload', (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });
    load();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
