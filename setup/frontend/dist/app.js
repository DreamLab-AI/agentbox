// Agentbox Setup Wizard + Operations Dashboard
// DreamLab AI — https://dreamlab.ai
(function () {
  'use strict';

  const POLL_INTERVAL = 5000;
  const MAX_EVENTS = 200;

  let state = {
    mode: 'setup',
    standalone: false,       // true = no Rust server, pure browser
    fileHandle: null,        // File System Access API handle (if available)
    config: null,
    schema: null,
    tomlContent: '',
    dirty: false,
    sections: [],
    activeSection: null,
    dashboardConnected: false,
    dashboardBaseUrl: '',    // direct mgmt API URL for standalone dashboard
    events: [],
    pollTimer: null,
    eventPollTimer: null,
  };

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return [...(ctx || document).querySelectorAll(sel)]; }

  function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  async function api(path, opts = {}) {
    const base = state.standalone ? state.dashboardBaseUrl : '/api';
    const url = state.standalone ? `${base}${path.replace(/^\/proxy/, '')}` : `${base}${path}`;
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...opts.headers },
      ...opts,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`${res.status}: ${text}`);
    }
    if (res.status === 204 || res.headers.get('content-length') === '0') return null;
    return res.json();
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function fmtUptime(s) {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  // Age of an event given a created_at (unix seconds or ms) → "12s"/"4m"/"2h"/"3d".
  function fmtAge(ts) {
    if (!ts && ts !== 0) return '—';
    let ms = Number(ts);
    if (!isFinite(ms)) return '—';
    if (ms < 1e12) ms *= 1000;            // seconds → ms
    let d = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    if (d < 60) return `${d}s`;
    if (d < 3600) return `${Math.floor(d / 60)}m`;
    if (d < 86400) return `${Math.floor(d / 3600)}h`;
    return `${Math.floor(d / 86400)}d`;
  }

  // ─── TOML Parser (minimal, handles agentbox.toml shape) ──────

  function parseTOML(text) {
    const result = {};
    let section = result;
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const hdr = line.match(/^\[([^\]]+)\]$/);
      if (hdr) {
        let obj = result;
        for (const k of hdr[1].split('.')) {
          if (!obj[k] || typeof obj[k] !== 'object') obj[k] = {};
          obj = obj[k];
        }
        section = obj;
        continue;
      }
      const kv = line.match(/^([a-zA-Z_][\w-]*)\s*=\s*(.+)$/);
      if (kv) section[kv[1]] = parseVal(kv[2].trim());
    }
    return result;
  }

  function parseVal(v) {
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (/^-?\d+$/.test(v)) return parseInt(v, 10);
    if (/^-?\d+\.\d+$/.test(v)) return parseFloat(v);
    if ((v[0] === '"' && v.at(-1) === '"') || (v[0] === "'" && v.at(-1) === "'"))
      return v.slice(1, -1);
    if (v[0] === '[' && v.at(-1) === ']')
      return v.slice(1, -1).split(',').map(s => parseVal(s.trim())).filter(x => x !== '');
    return v;
  }

  function toTOML(obj, pfx = '') {
    const lines = [], tables = [];
    for (const [k, v] of Object.entries(obj)) {
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) tables.push([k, v]);
      else lines.push(`${k} = ${toVal(v)}`);
    }
    for (const [k, v] of tables) {
      const p = pfx ? `${pfx}.${k}` : k;
      lines.push('', `[${p}]`, toTOML(v, p));
    }
    return lines.join('\n');
  }

  function toVal(v) {
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'number') return String(v);
    if (Array.isArray(v)) return `[${v.map(toVal).join(', ')}]`;
    return `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }

  // ─── Mode Switching ──────────────────────────────────────────

  function setMode(mode) {
    state.mode = mode;
    document.body.classList.toggle('view-setup', mode === 'setup');
    document.body.classList.toggle('view-dashboard', mode === 'dashboard');

    $$('.mode-toggle button').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });

    $('#mode-label').textContent = mode === 'setup' ? 'Configuration Wizard' : 'Operations Dashboard';

    if (mode === 'dashboard') startDashboard();
    else stopDashboard();
  }

  // ─── Standalone Mode: File I/O ───────────────────────────────

  function showStandalonePicker() {
    $('#loading').style.display = 'none';
    $('#standalone-picker').style.display = '';
    setStatus('standalone');

    // Show standalone UI controls
    if ($('#btn-open')) $('#btn-open').style.display = '';

    const dropZone = $('#drop-zone');
    const fileInput = $('#file-input');

    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('keydown', e => { if (e.key === 'Enter') fileInput.click(); });

    dropZone.addEventListener('dragover', e => {
      e.preventDefault();
      dropZone.style.borderColor = 'var(--amber)';
      dropZone.style.background = 'rgba(245, 158, 11, 0.05)';
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.style.borderColor = 'var(--border)';
      dropZone.style.background = '';
    });
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.style.borderColor = 'var(--border)';
      dropZone.style.background = '';
      const file = e.dataTransfer.files[0];
      if (file) loadFileFromDisk(file);
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files[0]) loadFileFromDisk(fileInput.files[0]);
    });
  }

  async function loadFileFromDisk(file) {
    const text = await file.text();
    state.tomlContent = text;
    state.config = parseTOML(text);

    // Try loading schema from relative path
    await loadBundledSchema();

    $('#standalone-picker').style.display = 'none';
    $('#editor').style.display = '';
    renderSections();
    setStatus('connected');

    // Update footer for standalone
    if ($('#btn-save')) $('#btn-save').style.display = 'none';
    if ($('#btn-cancel')) $('#btn-cancel').style.display = 'none';
    if ($('#btn-download')) $('#btn-download').style.display = '';
  }

  async function loadBundledSchema() {
    try {
      const res = await fetch('agentbox.toml.schema.json');
      if (res.ok) {
        state.schema = await res.json();
        return;
      }
    } catch {}
    // Fallback: try relative to parent dirs (common layout)
    for (const path of ['../schema/agentbox.toml.schema.json', '../../schema/agentbox.toml.schema.json']) {
      try {
        const res = await fetch(path);
        if (res.ok) { state.schema = await res.json(); return; }
      } catch {}
    }
    state.schema = null;
  }

  async function openFilePicker() {
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({
          types: [{ description: 'TOML', accept: { 'text/plain': ['.toml'] } }],
        });
        state.fileHandle = handle;
        const file = await handle.getFile();
        await loadFileFromDisk(file);
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }
    $('#file-input').click();
  }

  function downloadToml() {
    const blob = new Blob([state.tomlContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'agentbox.toml';
    a.click();
    URL.revokeObjectURL(url);
    state.dirty = false;
  }

  async function saveViaFileHandle() {
    if (!state.fileHandle) { downloadToml(); return; }
    try {
      const writable = await state.fileHandle.createWritable();
      await writable.write(state.tomlContent);
      await writable.close();
      state.dirty = false;
      setStatus('connected');
    } catch {
      downloadToml();
    }
  }

  // ─── Setup: Init & Render ────────────────────────────────────

  async function initSetup() {
    // Try connecting to Rust server first
    try {
      const res = await fetch('/api/config', {
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      state.standalone = false;
      state.tomlContent = data.toml_content;
      state.schema = data.schema;
      state.config = parseTOML(data.toml_content);
      renderSections();
      setStatus('connected');
      $('#loading').style.display = 'none';
      $('#editor').style.display = '';
      return;
    } catch {}

    // No server — enter standalone mode
    state.standalone = true;

    // Check URL params for mgmt API URL
    const params = new URLSearchParams(location.search);
    const mgmtUrl = params.get('api');
    if (mgmtUrl) state.dashboardBaseUrl = mgmtUrl.replace(/\/$/, '');

    // Check if agentbox.toml is co-located (served by any static server)
    try {
      const res = await fetch('agentbox.toml');
      if (res.ok) {
        const text = await res.text();
        if (text.includes('[') && text.includes('=')) {
          state.tomlContent = text;
          state.config = parseTOML(text);
          await loadBundledSchema();
          renderSections();
          setStatus('connected');
          $('#loading').style.display = 'none';
          $('#editor').style.display = '';

          // In standalone with co-located file, show download button
          if ($('#btn-save')) $('#btn-save').style.display = 'none';
          if ($('#btn-cancel')) $('#btn-cancel').style.display = 'none';
          if ($('#btn-download')) $('#btn-download').style.display = '';
          return;
        }
      }
    } catch {}

    // No co-located file — show picker
    showStandalonePicker();
  }

  const SECTION_META = {
    core:             { icon: '⚙️',  label: 'Core',            desc: 'Orchestration engine and vector database.' },
    mesh:             { icon: '🌐',  label: 'Mesh',            desc: 'Standalone or federated deployment mode (ADR-025).' },
    federation:       { icon: '🛰️', label: 'Federation',      desc: 'Standalone or client federation with a host container mesh.' },
    adapters:         { icon: '🔌',  label: 'Adapters',        desc: 'Five pluggable adapter slots (ADR-005).' },
    integrations:     { icon: '🔗',  label: 'Integrations',    desc: 'RuVector PG sidecar with PRD-018 retrieval gates (hybrid search, typed metadata, orient, health, TTL sweep), solid-pod-rs, ComfyUI.' },
    gpu:              { icon: '🎮',  label: 'GPU',             desc: 'GPU backend and acceleration.' },
    toolchains:       { icon: '🔧',  label: 'Toolchains',      desc: 'Language runtimes and dev tools.' },
    security:         { icon: '🛡️', label: 'Security',        desc: 'Sandbox policy, read-only rootfs.' },
    sovereign_mesh:   { icon: '🔐',  label: 'Sovereign Mesh',  desc: 'Nostr relay, NIP-98 auth, and the pure-Nostr mobile agent bridge (Amethyst+Amber phone → embedded relay → pod). Replaces the retired Telegram/CTM mirror.' },
    skills:           { icon: '🧠',  label: 'Skills',          desc: 'Pluggable skill modules.' },
    features:         { icon: '🧪',  label: 'Features',        desc: 'Feature flags (ExpeL lesson extraction, etc.).' },
    desktop:          { icon: '🖥️', label: 'Desktop',         desc: 'VNC desktop environment.' },
    linked_data:      { icon: '🔗',  label: 'Linked Data',     desc: 'JSON-LD federation surfaces (PRD-006).' },
    privacy_filter:   { icon: '🔒',  label: 'Privacy Filter',  desc: 'Local PII redaction sidecar (ADR-008).' },
    compression:      { icon: '📦',  label: 'Compression',     desc: 'Context-aware compression middleware (PRD-016).' },
    observability:    { icon: '📡',  label: 'Observability',   desc: 'Prometheus, OpenTelemetry.' },
    payments:         { icon: '💰',  label: 'Payments',        desc: 'DREAM token economy and Web Ledger.' },
    llm_marketplace:  { icon: '🏪',  label: 'Marketplace',     desc: 'LLM Resource Marketplace (kinds 38300-38305).' },
    providers:        { icon: '🤖',  label: 'Providers',       desc: 'LLM provider configuration and API keys.' },
    consultants:      { icon: '💬',  label: 'Consultants',     desc: 'LLM consultant MCPs — dual-path with direct tabs (PRD-013).' },
    networking:       { icon: '🌍',  label: 'Networking',      desc: 'Tailscale mesh and host gateway.' },
    plugins:          { icon: '🧩',  label: 'Plugins',         desc: 'Nix package plugins and extensions.' },
    memory:           { icon: '💾',  label: 'Memory',          desc: 'RuVector memory backend and access control.' },
    memory_learning:  { icon: '📈',  label: 'Memory Learning', desc: 'Trajectory-recording learning loop (PRD-018/ADR-036): record real (state, action, outcome, duration) tuples, aggregate effectiveness, feed retrieval/routing. Enable producers before consumers (W066).' },
    memory_hygiene:   { icon: '🧹',  label: 'Memory Hygiene',  desc: 'Gates for the non-dry-run data-hygiene ops (namespace repair, embedding backfill, legacy archival). Fail-closed: ops stay dry-run until a flag is set. Run via ./agentbox.sh ruvector <op>.' },
    project_tracking: { icon: '📋',  label: 'Project Tracking', desc: 'Sovereign project tracking (PRD-017/ADR-035): per-repo telemetry on /metrics, /v1/projects HTTP surface, kind-30841 nostr digests.' },
  };

  function renderSections() {
    const schema = state.schema?.properties || {};
    const container = $('#sections-container');
    const nav = $('#section-nav');
    container.innerHTML = '';
    nav.innerHTML = '';
    state.sections = [];

    // If no schema, render raw sections from parsed config
    const keys = Object.keys(schema).length > 0
      ? Object.entries(schema).filter(([, v]) => v.type === 'object').map(([k]) => k)
      : Object.keys(state.config).filter(k => typeof state.config[k] === 'object');

    for (const key of keys) {
      const schemaDef = schema[key] || { properties: {} };
      const meta = SECTION_META[key] || { icon: '📋', label: key, desc: '' };
      const data = state.config[key] || {};
      const id = `section-${key}`;

      const li = document.createElement('li');
      li.innerHTML = `<a href="#${id}" data-section="${key}">
        <span class="nav-icon">${meta.icon}</span> ${esc(meta.label)}
      </a>`;
      nav.appendChild(li);

      const sec = document.createElement('div');
      sec.className = 'section-card slide-up';
      sec.id = id;

      const props = schemaDef.properties || {};
      const hasSchema = Object.keys(props).length > 0;

      sec.innerHTML = `
        <div class="section-header">
          <div>
            <h2>${meta.icon} ${esc(meta.label)}</h2>
            <p class="section-desc">${esc(schemaDef.description || meta.desc)}</p>
          </div>
        </div>
        <div class="section-body">
          ${hasSchema ? renderFields(key, props, data) : renderRawFields(key, data)}
        </div>`;
      container.appendChild(sec);
      state.sections.push(key);
    }

    $$('#section-nav a').forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        document.getElementById(a.getAttribute('href').slice(1))
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setActiveNav(a.dataset.section);
      });
    });

    const obs = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (e.isIntersecting) setActiveNav(e.target.id.replace('section-', ''));
      }
    }, { threshold: 0.2, rootMargin: '-80px 0px -50% 0px' });
    $$('.section-card').forEach(s => obs.observe(s));

    container.addEventListener('change', handleChange);
    container.addEventListener('input', debounce(handleChange, 300));
  }

  function renderRawFields(sectionKey, data, prefix = '') {
    let html = '';
    for (const [key, value] of Object.entries(data)) {
      const path = prefix ? `${prefix}.${key}` : key;

      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        html += `<div class="subsection open">
          <button class="subsection-toggle" type="button">
            <span class="chevron">▸</span> ${esc(key.replace(/_/g, ' '))}
          </button>
          <div class="subsection-body">
            ${renderRawFields(sectionKey, value, path)}
          </div>
        </div>`;
        continue;
      }

      const fid = `f-${sectionKey}-${path.replace(/\./g, '-')}`;
      const label = key.replace(/_/g, ' ');

      if (typeof value === 'boolean') {
        html += `<div class="form-group">
          <label class="form-label" for="${fid}">${esc(label)}</label>
          <div class="toggle-wrap">
            <label class="toggle">
              <input type="checkbox" id="${fid}" ${value ? 'checked' : ''} data-section="${sectionKey}" data-key="${path}">
              <span class="toggle-track"><span class="toggle-thumb"></span></span>
            </label>
            <span class="toggle-state">${value ? 'Enabled' : 'Disabled'}</span>
          </div>
        </div>`;
      } else if (typeof value === 'number') {
        html += `<div class="form-group">
          <label class="form-label" for="${fid}">${esc(label)}</label>
          <input type="number" id="${fid}" value="${value}" data-section="${sectionKey}" data-key="${path}">
        </div>`;
      } else if (Array.isArray(value)) {
        html += `<div class="form-group">
          <label class="form-label" for="${fid}">${esc(label)}</label>
          <input type="text" id="${fid}" value="${esc(value.join(', '))}" placeholder="comma-separated" data-section="${sectionKey}" data-key="${path}">
        </div>`;
      } else {
        html += `<div class="form-group">
          <label class="form-label" for="${fid}">${esc(label)}</label>
          <input type="text" id="${fid}" value="${esc(String(value ?? ''))}" data-section="${sectionKey}" data-key="${path}">
        </div>`;
      }
    }
    return html;
  }

  function renderFields(sectionKey, props, data, prefix = '') {
    let html = '';
    for (const [key, prop] of Object.entries(props)) {
      const path = prefix ? `${prefix}.${key}` : key;

      if (prop.type === 'object' && prop.properties) {
        const sub = (typeof data[key] === 'object' && data[key]) ? data[key] : {};
        html += `<div class="subsection open">
          <button class="subsection-toggle" type="button">
            <span class="chevron">▸</span> ${esc(key.replace(/_/g, ' '))}
          </button>
          <div class="subsection-body">
            ${renderFields(sectionKey, prop.properties, sub, path)}
          </div>
        </div>`;
        continue;
      }

      const fid = `f-${sectionKey}-${path.replace(/\./g, '-')}`;
      const label = key.replace(/_/g, ' ');
      const hint = prop.description || '';

      html += `<div class="form-group">
        <label class="form-label" for="${fid}">${esc(label)}</label>
        ${hint ? `<div class="form-hint">${esc(hint)}</div>` : ''}
        ${renderInput(fid, sectionKey, path, prop, data[key])}
      </div>`;
    }
    return html;
  }

  function renderInput(id, section, key, prop, value) {
    const da = `data-section="${section}" data-key="${key}"`;

    if (prop.enum) {
      return `<select id="${id}" ${da}>
        ${prop.enum.map(v => `<option value="${esc(v)}" ${value === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}
      </select>`;
    }

    if (prop.type === 'boolean') {
      return `<div class="toggle-wrap">
        <label class="toggle">
          <input type="checkbox" id="${id}" ${value ? 'checked' : ''} ${da}>
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
        <span class="toggle-state">${value ? 'Enabled' : 'Disabled'}</span>
      </div>`;
    }

    if (prop.type === 'integer' || prop.type === 'number') {
      const v = value ?? prop.default ?? '';
      const min = prop.minimum != null ? `min="${prop.minimum}"` : '';
      const max = prop.maximum != null ? `max="${prop.maximum}"` : '';
      return `<input type="number" id="${id}" value="${v}" ${min} ${max} ${da}>`;
    }

    if (prop.type === 'array') {
      const v = Array.isArray(value) ? value.join(', ') : (value || '');
      return `<input type="text" id="${id}" value="${esc(String(v))}" placeholder="comma-separated" ${da}>`;
    }

    const v = value ?? prop.default ?? '';
    const ph = prop.examples ? `placeholder="${esc(String(prop.examples[0]))}"` : '';
    return `<input type="text" id="${id}" value="${esc(String(v))}" ${ph} ${da}>`;
  }

  function handleChange(e) {
    const el = e.target;
    if (!el.dataset?.section) return;

    let value;
    if (el.type === 'checkbox') {
      value = el.checked;
      const lbl = el.closest('.toggle-wrap')?.querySelector('.toggle-state');
      if (lbl) lbl.textContent = value ? 'Enabled' : 'Disabled';
    } else if (el.type === 'number') {
      value = el.value === '' ? undefined : Number(el.value);
    } else {
      value = el.value;
    }

    if (!state.config[el.dataset.section]) state.config[el.dataset.section] = {};
    const keys = el.dataset.key.split('.');
    let obj = state.config[el.dataset.section];
    for (let i = 0; i < keys.length - 1; i++) {
      if (!obj[keys[i]]) obj[keys[i]] = {};
      obj = obj[keys[i]];
    }
    obj[keys.at(-1)] = value;

    state.dirty = true;
    state.tomlContent = toTOML(state.config);
  }

  function setActiveNav(key) {
    if (state.activeSection === key) return;
    state.activeSection = key;
    $$('#section-nav li').forEach(li => {
      li.classList.toggle('active', li.querySelector('a')?.dataset.section === key);
    });
  }

  // Subsection toggle delegation
  document.addEventListener('click', e => {
    const btn = e.target.closest('.subsection-toggle');
    if (!btn) return;
    btn.closest('.subsection')?.classList.toggle('open');
  });

  // ─── Dashboard ───────────────────────────────────────────────

  function startDashboard() {
    if (state.standalone && !state.dashboardBaseUrl) {
      const url = prompt('Management API URL:', 'http://localhost:9090');
      if (url) state.dashboardBaseUrl = url.replace(/\/$/, '');
      else { setMode('setup'); return; }
    }
    if (state.pollTimer) return;
    pollDashboard();
    state.pollTimer = setInterval(pollDashboard, POLL_INTERVAL);
    pollEvents();
  }

  function stopDashboard() {
    clearInterval(state.pollTimer);
    clearTimeout(state.eventPollTimer);
    state.pollTimer = null;
    state.eventPollTimer = null;
  }

  async function pollDashboard() {
    try {
      const prefix = state.standalone ? '' : '/proxy';
      const [health, status, tasks, approvals] = await Promise.allSettled([
        api(`${prefix}/health`),
        api(`${prefix}/v1/status`),
        api(`${prefix}/v1/tasks`),
        api(`${prefix}/v1/approvals`),
      ]);

      renderStatusCards(status.value);
      renderServiceGrid(status.value);
      renderTaskList(tasks.value);
      renderAdapters(health.value);
      renderApprovals(approvals.status === 'fulfilled' ? approvals.value : null);
      setConnected(true);
    } catch {
      setConnected(false);
    }
  }

  async function pollEvents() {
    if (state.mode !== 'dashboard') return;
    try {
      const prefix = state.standalone ? '' : '/proxy';
      const evts = await api(`${prefix}/v1/agent-events?limit=20`);
      if (Array.isArray(evts)) {
        for (const ev of evts) {
          if (!state.events.find(e => e.id === ev.id)) {
            state.events.unshift(ev);
            if (state.events.length > MAX_EVENTS) state.events.pop();
          }
        }
        renderEvents();
      }
    } catch { /* container may not be up */ }
    if (state.mode === 'dashboard') {
      state.eventPollTimer = setTimeout(pollEvents, 3000);
    }
  }

  function renderStatusCards(status) {
    const el = $('#status-cards');
    if (!status) {
      el.innerHTML = '<div class="metric-card"><span class="metric-label">Container</span><span class="metric-number text-pink">Offline</span></div>';
      return;
    }
    el.innerHTML = `
      <div class="metric-card">
        <span class="metric-label">Uptime</span>
        <span class="metric-number">${fmtUptime(status.uptime_seconds || 0)}</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">GPU</span>
        <span class="metric-number">${esc(status.gpu?.name || 'None')}</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">Memory</span>
        <span class="metric-number">${status.memory ? `${Math.round(status.memory.used_mb)}/${Math.round(status.memory.total_mb)} MB` : '—'}</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">Tasks</span>
        <span class="metric-number text-amber">${status.active_tasks ?? 0}</span>
      </div>`;
  }

  const SERVICES = [
    { name: 'Management API', port: 9090, icon: '🔧', core: true },
    { name: 'RuVector PG',    port: 5432, icon: '🧠', core: true },
    { name: 'Prometheus',     port: 9091, icon: '📊', core: true },
    { name: 'Solid Pod',      port: 8484, icon: '🔐', core: false },
    { name: 'Jupyter Lab',    port: 8888, icon: '📓', core: false },
    { name: 'Code Server',    port: 8080, icon: '💻', core: false },
    { name: 'VNC Desktop',    port: 5901, icon: '🖥️', core: false },
    { name: 'Nostr Relay',    port: 7777, icon: '📡', core: false },
    { name: 'Privacy Filter', port: 9092, icon: '🔒', core: false },
  ];

  function renderServiceGrid(status) {
    const el = $('#service-grid');
    el.innerHTML = SERVICES.map(svc => {
      const up = state.dashboardConnected && (svc.core || svc.port === 9090);
      const cls = up ? 'healthy' : 'offline';
      return `<div class="service-card" data-tooltip=":${svc.port}">
        <div class="service-card-header">
          <span class="service-card-title">${svc.icon} ${svc.name}</span>
          <span class="service-card-subtitle">:${svc.port}</span>
        </div>
        <div class="service-status ${cls}">
          <span class="dot"></span> ${up ? 'healthy' : 'unknown'}
        </div>
      </div>`;
    }).join('');
  }

  function renderTaskList(tasks) {
    const el = $('#task-list');
    if (!tasks || !Array.isArray(tasks) || !tasks.length) {
      el.innerHTML = '<p style="text-align:center;color:var(--text-tertiary);padding:var(--sp-8);">No active tasks</p>';
      return;
    }
    el.innerHTML = tasks.map(t => `
      <div class="task-card">
        <div class="task-info">
          <span class="task-title">${esc(t.id || t.taskId || '—')}</span>
          <span class="task-meta">${esc(t.description || t.command || '')}</span>
        </div>
        <span class="tag ${t.status === 'running' ? 'amber' : 'green'}">${esc(t.status || 'unknown')}</span>
      </div>`).join('');
  }

  function renderAdapters(health) {
    const el = $('#adapter-cards');
    if (!health) {
      el.innerHTML = '<p style="color:var(--text-tertiary);">Waiting for adapter status…</p>';
      return;
    }
    const slots = ['beads', 'pods', 'memory', 'events', 'orchestrator'];
    const icons = { beads: '📦', pods: '🗄️', memory: '🧠', events: '📨', orchestrator: '🎯' };
    el.innerHTML = slots.map(s => {
      const st = health[s] || 'unknown';
      const cls = st === 'healthy' ? 'green' : st === 'off' ? '' : 'amber';
      return `<span class="tag ${cls}">${icons[s]} ${s}: ${st}</span>`;
    }).join(' ');
  }

  // ─── Pending Approvals (authority gate — ADR-043 D4.7) ───────
  // Renders open kind-31402 ActionRequests and posts a signed decision via
  // /v1/approvals/:id/decide. Builder B owns those endpoints; field extraction
  // is defensive so it survives minor contract shape differences.

  const approvalsBusy = new Set();   // ids with an in-flight decision

  function approvalField(a, keys) {
    for (const k of keys) {
      const parts = k.split('.');
      let v = a;
      for (const p of parts) v = (v == null ? undefined : v[p]);
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return null;
  }

  function renderApprovals(list) {
    const el = $('#approval-list');
    const ct = $('#approval-count');
    if (!el) return;
    const items = Array.isArray(list) ? list : (list && Array.isArray(list.approvals) ? list.approvals : []);
    if (ct) ct.textContent = items.length;
    if (!items.length) {
      el.innerHTML = '<p style="text-align:center;color:var(--text-tertiary);padding:var(--sp-8);">No pending approvals</p>';
      return;
    }
    el.innerHTML = items.map(a => {
      const id = approvalField(a, ['id', 'request_event_id', 'event_id', 'requestId', 'd']);
      const cls = approvalField(a, ['action_class', 'actionClass', 'authority_class', 'class', 'fields.action_class', 'subject_kind']);
      const target = approvalField(a, ['target', 'subject', 'subject_id', 'subjectId', 'title', 'fields.target']);
      const requester = approvalField(a, ['requester', 'requester_did', 'did', 'pubkey', 'author', 'actor']);
      const created = approvalField(a, ['created_at', 'timestamp', 'ts', 'age_start']);
      const reqShort = requester ? String(requester).replace(/^did:nostr:/, '').slice(0, 16) : 'unknown';
      const busy = id != null && approvalsBusy.has(String(id));
      const idAttr = id != null ? esc(String(id)) : '';
      return `<div class="approval-card task-card" data-approval-id="${idAttr}">
        <div class="task-info">
          <span class="task-title">${esc(cls || 'action')}${target ? ` → ${esc(String(target))}` : ''}</span>
          <span class="task-meta mono">${esc(reqShort)}${requester ? '…' : ''} · ${esc(fmtAge(created))} ago</span>
        </div>
        <div class="flex gap-4" style="align-items:center;">
          <button class="btn btn-primary approval-decide" data-decision="approve" data-approval-id="${idAttr}" ${busy || !id ? 'disabled' : ''}>Approve</button>
          <button class="btn btn-ghost approval-decide" data-decision="deny" data-approval-id="${idAttr}" ${busy || !id ? 'disabled' : ''}>Deny</button>
        </div>
      </div>`;
    }).join('');
  }

  async function decideApproval(id, decision) {
    if (!id || approvalsBusy.has(String(id))) return;
    approvalsBusy.add(String(id));
    const row = $(`.approval-card[data-approval-id="${CSS.escape(String(id))}"]`);
    if (row) $$('.approval-decide', row).forEach(b => { b.disabled = true; });
    try {
      const prefix = state.standalone ? '' : '/proxy';
      await api(`${prefix}/v1/approvals/${encodeURIComponent(id)}/decide`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      });
      // Optimistically drop the row; the next poll reconciles authoritatively.
      if (row) row.remove();
      const ct = $('#approval-count');
      if (ct) ct.textContent = Math.max(0, (parseInt(ct.textContent, 10) || 1) - 1);
    } catch (e) {
      alert(`Decision failed: ${e.message}`);
      if (row) $$('.approval-decide', row).forEach(b => { b.disabled = false; });
    } finally {
      approvalsBusy.delete(String(id));
    }
  }

  function onApprovalClick(e) {
    const btn = e.target.closest('.approval-decide');
    if (!btn || btn.disabled) return;
    decideApproval(btn.dataset.approvalId, btn.dataset.decision);
  }

  function renderEvents() {
    const el = $('#event-stream');
    const ct = $('#event-count');
    ct.textContent = state.events.length;
    if (!state.events.length) {
      el.innerHTML = '<p style="text-align:center;color:var(--text-tertiary);padding:var(--sp-8);">Waiting for agent activity…</p>';
      return;
    }
    el.innerHTML = state.events.slice(0, 50).map(ev => {
      const time = fmtTime(ev.timestamp || ev.created_at || Date.now());
      const action = ev.action || ev.type || 'event';
      const msg = ev.detail || ev.message || ev.data || '';
      return `<div class="event-entry">
        <span class="event-time mono">${time}</span>
        <span class="event-type info">${esc(action)}</span>
        <span class="event-msg">${esc(String(msg).slice(0, 140))}</span>
      </div>`;
    }).join('');
  }

  function setConnected(ok) {
    state.dashboardConnected = ok;
    $$('.connection-indicator').forEach(el => {
      el.classList.toggle('live', ok);
      el.classList.toggle('disconnected', !ok);
    });
  }

  // ─── Status Badge ────────────────────────────────────────────

  function setStatus(type) {
    const el = $('#status');
    el.className = `status-badge ${type}`;
    const labels = {
      connected: 'ready',
      error: 'error',
      standalone: 'standalone',
    };
    el.textContent = labels[type] || 'loading…';
  }

  // ─── Quick Actions ───────────────────────────────────────────

  const PORT_MAP = {
    'open-jupyter': 8888,
    'open-code':    8080,
    'open-vnc':     5901,
    'open-lo':      [9090, '/lo/'],
    'open-metrics': 9091,
    'open-solid':   8484,
  };

  function handleAction(action) {
    const t = PORT_MAP[action];
    if (!t) return;
    const url = Array.isArray(t) ? `http://localhost:${t[0]}${t[1]}` : `http://localhost:${t}`;
    window.open(url, '_blank');
  }

  // ─── Footer Actions ──────────────────────────────────────────

  async function saveAndExit() {
    if (state.standalone) {
      await saveViaFileHandle();
      return;
    }
    const btn = $('#btn-save');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      await api('/config', { method: 'POST', body: JSON.stringify({ toml_content: state.tomlContent }) });
      setStatus('connected');
      btn.textContent = '✓ Saved';
      setTimeout(async () => {
        try { await api('/shutdown', { method: 'POST' }); } catch {}
        window.close();
      }, 500);
    } catch (e) {
      setStatus('error');
      btn.textContent = 'Save & Exit';
      btn.disabled = false;
      alert(`Save failed: ${e.message}`);
    }
  }

  async function quitNoSave() {
    if (state.dirty && !confirm('Unsaved changes will be lost. Quit anyway?')) return;
    if (!state.standalone) {
      try { await api('/shutdown', { method: 'POST' }); } catch {}
    }
    window.close();
  }

  function openRawEditor() {
    $('#raw-toml').value = state.tomlContent;
    $('#raw-modal').showModal();
  }

  function applyRaw() {
    const txt = $('#raw-toml').value;
    try {
      state.config = parseTOML(txt);
      state.tomlContent = txt;
      state.dirty = true;
      renderSections();
      $('#raw-modal').close();
    } catch (e) {
      alert(`Invalid TOML: ${e.message}`);
    }
  }

  // ─── Init ────────────────────────────────────────────────────

  function init() {
    $$('.mode-toggle button').forEach(b =>
      b.addEventListener('click', () => setMode(b.dataset.mode))
    );

    $('#btn-save')?.addEventListener('click', saveAndExit);
    $('#btn-cancel')?.addEventListener('click', quitNoSave);
    $('#btn-raw')?.addEventListener('click', openRawEditor);
    $('#btn-download')?.addEventListener('click', downloadToml);
    $('#btn-open')?.addEventListener('click', openFilePicker);
    $('#raw-apply')?.addEventListener('click', applyRaw);
    $('#raw-cancel')?.addEventListener('click', () => $('#raw-modal').close());

    $$('[data-action]').forEach(b =>
      b.addEventListener('click', () => handleAction(b.dataset.action))
    );

    // Pending-approvals decisions (delegated so it survives poll re-renders).
    $('#approval-list')?.addEventListener('click', onApprovalClick);

    $('#raw-modal')?.addEventListener('click', e => {
      if (e.target === e.currentTarget) e.currentTarget.close();
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && $('#raw-modal')?.open) $('#raw-modal').close();
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (state.mode === 'setup') {
          state.standalone ? downloadToml() : saveAndExit();
        }
      }
    });

    initSetup();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
